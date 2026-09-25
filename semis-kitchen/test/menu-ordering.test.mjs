import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemGroups, moveMenuGroup } from '../src/lib/menuOrdering.js';
const sample = [
  {id:'a',cat:'fried'}, {id:'b',cat:'fried'}, {id:'z',cat:'frozen'},
  {id:'combo',cat:'mains',isCombo:true}, {id:'main',cat:'mains'},
  {id:'mc-chattipathiri-1kg',cat:'mains'}, {id:'mc-chattipathiri-1-5kg',cat:'mains'},
  {id:'mc-chattipathiri-2kg',cat:'mains'},
];
test('move within section preserves other sections and does not mutate original', () => {
  const groups = itemGroups(sample);
  assert.deepEqual(moveMenuGroup(sample,groups[1].key,groups[0].key,false).map(i=>i.id),['b','a',...sample.slice(2).map(i=>i.id)]);
  assert.deepEqual(moveMenuGroup(sample,groups[0].key,groups[1].key,true).slice(0,2).map(i=>i.id),['b','a']);
  assert.equal(sample[0].id,'a');
  assert.equal(moveMenuGroup(sample,groups[0].key,groups[2].key,false),sample);
});
test('weight options are one movable group and combos cannot be mixed with mains', () => {
  const groups = itemGroups(sample);
  const chatti = groups.at(-1), main = groups.at(-2), combo = groups.at(-3);
  assert.equal(chatti.items.length,3);
  const moved = moveMenuGroup(sample,chatti.key,main.key,false);
  assert.deepEqual(moved.slice(-4).map(i=>i.id),[...sample.slice(-3).map(i=>i.id),'main']);
  assert.equal(moveMenuGroup(sample,chatti.key,combo.key,false),sample);
});
