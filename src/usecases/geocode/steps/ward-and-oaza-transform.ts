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
import { DebugLogger } from '@domain/services/logger/debug-logger';
import { MatchLevel } from '@domain/types/geocode/match-level';
import { OazaChoMachingInfo } from '@domain/types/geocode/oaza-cho-info';
import { Transform, TransformCallback } from 'node:stream';
import { Query } from '../models/query';
import { jisKanji } from '../services/jis-kanji';
import { kan2num } from '../services/kan2num';
import { toHiragana } from '../services/to-hiragana';
import { TrieAddressFinder } from '../services/trie/trie-finder';
import timers from 'node:timers/promises';

export class WardAndOazaTransform extends Transform {

  private readonly wardAndOazaTrie: TrieAddressFinder<OazaChoMachingInfo>;
  private readonly logger: DebugLogger | undefined;
  private initialized: boolean = false;

  constructor(params: Required<{
    wardAndOazaList: OazaChoMachingInfo[];
    logger: DebugLogger | undefined;
  }>) {
    super({
      objectMode: true,
    });
    this.logger = params.logger;
    
    // 〇〇市町村のトライ木
    this.wardAndOazaTrie = new TrieAddressFinder();
    setImmediate(() => {
      for (const wardAndOaza of params.wardAndOazaList) {
        this.wardAndOazaTrie.append({
          key: this.normalizeStr(wardAndOaza.key),
          value: wardAndOaza,
        });
      }
      this.initialized = true;
    })
  }

  async _transform(
    queries: Query[],
    _: BufferEncoding,
    next: TransformCallback
  ) {

    const results = [];
    for (const query of queries) {
      if (!query.tempAddress) {
        results.push(query);
        continue;
      }
      // 既に判明している場合はスキップ
      if (query.match_level.num >= MatchLevel.CITY.num) {
        results.push(query);
        continue;
      }

      if (!this.initialized) {
        await new Promise(async (resolve: (_?: unknown[]) => void) => {
          while (!this.initialized) {
            await timers.setTimeout(100);
          }
          resolve();
        });
      }
  
      // -------------------------
      // 〇〇市町村を探索する
      // -------------------------
      const trieResults = this.wardAndOazaTrie.find({
        target: query.tempAddress,
        extraChallenges: ['市', '町', '村'],
        partialMatches: true,
        fuzzy: query.fuzzy,
      });
      if (!trieResults || trieResults.length === 0) {
        results.push(query);
        continue;
      }
      const matchedResults = trieResults
        // 都道府県が判別していない、または判別できでいて、result.pref_key が同一のもの
        // (伊達市のように同じ市町村名でも異なる都道府県の場合がある)
        .filter(result => {
          return (query.match_level.num === MatchLevel.UNKNOWN.num || 
            query.match_level.num === MatchLevel.PREFECTURE.num &&
            query.pref_key === result.info?.pref_key
          );
        })
        .map(result => {
          return query.copy({
            pref: query.pref || result.info!.pref,
            pref_key: query.pref_key || result.info!.pref_key,
            city_key: result.info!.city_key,
            tempAddress: result.unmatched,
            city: result.info!.city,
            county: result.info!.county,
            lg_code: result.info!.lg_code,
            ward: result.info!.ward,
            rep_lat: result.info!.rep_lat,
            rep_lon: result.info!.rep_lon,
            machiaza_id: result.info!.machiaza_id,
            oaza_cho: result.info!.oaza_cho,
            match_level: MatchLevel.CITY,
            coordinate_level: MatchLevel.MACHIAZA,
            matchedCnt: query.matchedCnt + result.depth,
          });
        });
      if (matchedResults.length === 0) {
        results.push(query);
      } else {
        matchedResults.forEach(matched => results.push(matched));
      }
    }
    this.logger?.info(`ward_and_oaza : ${((Date.now() - results[0].startTime) / 1000).toFixed(2)} s`);
    next(null, results);
  }

  private normalizeStr(value: string): string {
    // 半角カナ・全角カナ => 平仮名
    value = toHiragana(value);

    // JIS 第2水準 => 第1水準 及び 旧字体 => 新字体
    value = jisKanji(value);

    // 漢数字 => 算用数字
    value = kan2num(value);

    return value;
  }
}
