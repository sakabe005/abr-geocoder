const addrPatches = [
  {
    pref: '香川県',
    city: '仲多度郡まんのう町',
    town: '勝浦',
    pattern: '^字?家6',
    result: '家六',
  },
  {
    pref: '愛知県',
    city: 'あま市',
    town: '西今宿',
    pattern: '^字?梶村1',
    result: '梶村一',
  },
  {
    pref: '香川県',
    city: '丸亀市',
    town: '原田町',
    pattern: '^字?東三分1',
    result: '東三分一',
  },
];

export const patchAddr = (
  prefecture: string,
  city: string,
  town: string,
  address: string
): string => {
  let result = address;
  for (let i = 0; i < addrPatches.length; i++) {
    const patch = addrPatches[i];
    if (
      patch.pref === prefecture &&
      patch.city === city &&
      patch.town === town
    ) {
      result = result.replace(new RegExp(patch.pattern), patch.result);
    }
  }

  return result;
};
