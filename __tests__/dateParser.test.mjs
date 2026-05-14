import { formatDueDisplay } from '../src/utils/dateParser.js';

function daysFromToday(offset) {
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + offset);
  return d.getFullYear()+"-"+(d.getMonth()+1).toString().padStart(2,'0')+"-"+d.getDate().toString().padStart(2,'0');
}

function assert(msg, cond, show) {
  if (!cond) throw new Error('❌ ' + msg + (show? ' | value: '+show : ''));
  else console.log('✅', msg);
}

const today = daysFromToday(0);
const plus1 = daysFromToday(1);
const plus5 = daysFromToday(5);
const minus3 = daysFromToday(-3);

console.log('today?', today, '->', formatDueDisplay(today));
console.log('plus1?', plus1, '->', formatDueDisplay(plus1));
console.log('plus5?', plus5, '->', formatDueDisplay(plus5));
console.log('minus3?', minus3, '->', formatDueDisplay(minus3));

assert('today', formatDueDisplay(today).includes('วันนี้'), formatDueDisplay(today));
assert('tomorrow', formatDueDisplay(plus1).includes('พรุ่งนี้'), formatDueDisplay(plus1));
assert('plus5', formatDueDisplay(plus5).includes('อีก 5 วัน'), formatDueDisplay(plus5));
assert('overdue', formatDueDisplay(minus3).includes('เกินกำหนด 3 วัน'), formatDueDisplay(minus3));

console.log('All dateParser formatDueDisplay tests passed.');