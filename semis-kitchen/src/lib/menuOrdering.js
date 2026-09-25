export const sectionOf = item => item.cat === 'mains' && item.isCombo ? 'combos' : item.cat;
const WEIGHTS = new Set(['mc-chattipathiri-1kg','mc-chattipathiri-1-5kg','mc-chattipathiri-2kg']);
export function itemGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const section = sectionOf(item);
    const key = `${section}:${WEIGHTS.has(item.id) ? 'chattipathiri-weights' : item.id}`;
    if (!groups.has(key)) groups.set(key,{key,section,items:[]});
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}
export function moveMenuGroup(items, fromKey, targetKey, after) {
  const groups = itemGroups(items);
  const from = groups.find(g=>g.key===fromKey), target = groups.find(g=>g.key===targetKey);
  if (!from || !target || from===target || from.section!==target.section) return items;
  const remaining = groups.filter(g=>g!==from);
  remaining.splice(remaining.indexOf(target)+(after?1:0),0,from);
  const result = remaining.flatMap(g=>g.items);
  return result.every((item,i)=>item.id===items[i].id) ? items : result;
}
