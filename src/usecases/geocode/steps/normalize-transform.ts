/*!
 * MIT License
 *
 * Copyright (c) 2023 デジタル庁
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { Transform, TransformCallback } from 'node:stream';
import { DASH, DASH_SYMBOLS, DOUBLE_QUOTATION, J_DASH, MUBANCHI, NUMRIC_AND_KANJI_SYMBOLS, NUMRIC_SYMBOLS, OAZA_BANCHO, SINGLE_QUOTATION, SPACE, SPACE_CHARS, SPACE_SYMBOLS, VIRTUAL_SPACE, ZENKAKU } from '@config/constant-values';
import { RegExpEx } from '@domain/services/reg-exp-ex';
import { Query, QueryInput } from '../models/query';
import { jisKanjiForCharNode } from '../services/jis-kanji';
import { kan2numForCharNode } from '../services/kan2num';
import { toHankakuAlphaNumForCharNode } from '../services/to-hankaku-alpha-num';
import { toHiraganaForCharNode } from '../services/to-hiragana';
import { CharNode } from '../services/trie/char-node';
import { DebugLogger } from '@domain/services/logger/debug-logger';
import { removeUnwantedCharacters } from '@domain/services/remove-unwanted-characters';

export class NormalizeTransform extends Transform {

  constructor(private params: {
    logger?: DebugLogger;
    fuzzy?: string | undefined;
  }) {
    super({
      objectMode: true,
    });
  }

  _transform(
    input: QueryInput,
    _: BufferEncoding,
    callback: TransformCallback
  ): void {
    
    // Unicode正規化を行う
    // https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
    input.data.address = input.data.address.normalize('NFC');
    
    // 日本語の漢字、ひらがな、カタカナ、全角アルファベット、全角数字、全角記号を残し
    // 文字化け、絵文字などの非標準文字を削除
    input.data.address = removeUnwantedCharacters(input.data.address, this.params.fuzzy || '');

    const query = Query.create(input);
    
    let address : CharNode | undefined = query.tempAddress;
    //
    // 入力された住所に対して以下の正規化を予め行う。
    //
    // 1. 全角のアラビア英数字（０-９Ａ-Ｚａ-ｚ）を半角英数字(0-9A-Za-z)に置換する
    // 2. 全角スペースを半角スペースに変換s
    // 3. 最初に出てくる `1-` や `五-` のような文字列を町丁目とみなして、それ以前のスペースをすべて削除する。
    //
    // オリジナルコード
    // https://github.com/digital-go-jp/abr-geocoder/blob/a42a079c2e2b9535e5cdd30d009454cddbbca90c/src/engine/normalize.ts#L271-L294
    //

    // クォーテーションマークがあれば、削除する。
    address = address?.replaceAll(SINGLE_QUOTATION, '');
    address = address?.replaceAll(DOUBLE_QUOTATION, '');
    
    // 空白記号(半角・全角)は、SPACEに置換
    address = address?.replace(
      RegExpEx.create(`[${SPACE_CHARS}]+`, 'g'),
      SPACE,
    );
    
    // 全角のアラビア数字は問答無用で半角にする
    address = toHankakuAlphaNumForCharNode(address);

    // アラビア数字の直後に全角が来る場合は、仮想のスペース記号を入れる
    // (〇〇番地32三田マンション　のように、「2」の直後に「三」が来た場合に区切りをつけるため)
    address = address?.replace(
      RegExpEx.create(
        `(${NUMRIC_SYMBOLS})(${ZENKAKU})`,
        'g',
      ),
      `$1${VIRTUAL_SPACE}$2`
    );

    // 数字＋ダッシュ　または ダッシュ+数字　の組み合わせのとき、ダッシュを DASHにする
    // (ダッシュの記号は類似するものが多いので、統一する)
    address = address?.replace(
      RegExpEx.create(
        `([${NUMRIC_AND_KANJI_SYMBOLS}][${DASH_SYMBOLS}])|([${DASH_SYMBOLS}])([${NUMRIC_AND_KANJI_SYMBOLS}])`,
        'g'
      ),
      (match: string) => {
        return match.replace(RegExpEx.create(`[${DASH_SYMBOLS}]`, 'g'), DASH);
      },
    );

    
    // 〇〇町や〇〇番地　より前にある SPACEはすべて削除
    address = address?.replace(
      RegExpEx.create(`(.+)(丁目?|番(町|地|丁)|条|軒|線|(${J_DASH})町|地割)`),
      (match: string) => {
        return match.replace(RegExpEx.create(`[${SPACE_SYMBOLS}]`, 'g'), '');
      }
    );

    // 半角カナ・全角カナ => 平仮名
    address = toHiraganaForCharNode(address);

    // JIS 第2水準 => 第1水準 及び 旧字体 => 新字体
    address = jisKanjiForCharNode(address);

    // DBに島の名前が入っていないので、消しておく
    address = address?.replace('八丈島', '');
    address = address?.replace('三宅島', '');
    
    // 大字が「番町」の場合があるので、置換する
    address = address?.replace(RegExpEx.create('(高松市|岡山市北区|北区)番町', 'g'), `$1${OAZA_BANCHO}`);

    // 漢数字 => 算用数字
    address = kan2numForCharNode(address);

    // 「大字」「字」を削除する
    address = address?.replaceAll(RegExpEx.create('大?字', 'g'), '');

    // 「無番地」を「MUBANCHI」にする
    address = address?.replace(RegExpEx.create('無番地'), MUBANCHI);

    // 「番地」「番丁」「番町」「番街」「番」「番地の」をDASHにする
    address = address?.replaceAll(RegExpEx.create('([0-9]+)番[丁地街町]?[の目]?', 'g'), `$1${DASH}`);

    // 「〇〇番地〇〇号」の「号」を DASH にする
    // 「〇〇号室」「〇〇号棟」「〇〇号区」は変換しない
    address = address?.replaceAll(RegExpEx.create(`(${DASH}[0-9]+)号(?!室|棟|区)`, 'g'), '$1');


    this.params.logger?.info(`normalize : ${((Date.now() - query.startTime) / 1000).toFixed(2)} s`);
    callback(null, [query.copy({
      tempAddress: address,
    })]);
  }
}
