export const TEST_CIDS = [
  'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
  'bafkreigks6arfsq3xxfpvqrrwonchxcnu6do76auprhhfomao6c273sixm',
  'bafkreib6epubmabzlffdhckpmvsodmjuro6xuaei2qwevs3t52xnlhaatu',
  'bafkreibopuwahkkqplrgl3hvwu2wrbnfgoj2eau5eqjzjglsmwq2ewxpyy',
  'bafkreiazadvlnqbija6xcjszt3tpkdpa2j4qpnogl6uqkjcybnfq7gcswa',
  'bafkreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm',
  'bafkreiafwov7ev42l23gia6npc7fk76ymbrtuh7cca6hmqqdbxx6gldfp4',
  'bafkreihrnuc6y2zjesgsyynnwhusmp3y4t33vtq3svibjiwrpbzm7zagju',
] as const;

export const TEST_CID = TEST_CIDS[0];

export function testCid(seed: number): string {
  return TEST_CIDS[Math.abs(seed) % TEST_CIDS.length] ?? TEST_CID;
}
