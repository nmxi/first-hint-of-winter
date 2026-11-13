// 各景を一巡するまで重複させず、読み込みのたびに順番を変える。
export function shuffleScenes(scenes) {
  const order = [...scenes];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
