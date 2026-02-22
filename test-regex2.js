const fs = require('fs');
const html = fs.readFileSync('ddg.html', 'utf8');
const pattern = /<a\s[^>]*href\s*=\s*(['\"'])(.*?)\1[^>]*>/gi;
let match;
let count = 0;
while ((match = pattern.exec(html)) !== null) {
  console.log(match[2]);
  count++;
}
console.log('Total matches:', count);
