/*
 * 生成本地 Demo 页：chrome.* 打桩逻辑在 _harness-shim.js，这里只拼 HTML。
 * 用法：node eval/make-harness.js
 */
const fs = require('fs');
const path = require('path');

const pages = path.join(__dirname, '..', 'src', 'pages');
const html = fs.readFileSync(path.join(pages, 'demo.html'), 'utf8');

fs.writeFileSync(
  path.join(pages, '_harness.html'),
  html.replace(
    '<script src="demo.js"></script>',
    '<script src="../lib/fg-lib.js"></script>\n<script src="_harness-shim.js"></script>\n<script src="demo.js"></script>'
  ),
  'utf8'
);
console.log('wrote src/pages/_harness.html');
