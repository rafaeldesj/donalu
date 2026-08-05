const fs = require('fs');

const oldFile = fs.readFileSync('SettingsPage_old_utf8.tsx', 'utf8');
const curFile = fs.readFileSync('src/pages/SettingsPage.tsx.bak', 'utf8');

// 1. Get original printer block
const startStr = "{activeTab === 'printer' && (isAdmin || role === 'staff') && (";
const startIdx = oldFile.indexOf(startStr);
const endIdx = oldFile.indexOf("</main>", startIdx);
const printerBlock = oldFile.substring(startIdx, endIdx);

// 2. Rename 'printer' to 'elgin_i8' in curFile's printer block (which contains the Elgin layout)
const curFileMod = curFile.replace(startStr, "{activeTab === 'elgin_i8' && (isAdmin || role === 'staff') && (");

// 3. Inject original printerBlock right before elgin_i8 block
const elginIdx = curFileMod.indexOf("{activeTab === 'elgin_i8' && (isAdmin || role === 'staff') && (");
const newContent = curFileMod.substring(0, elginIdx) + printerBlock + '\n          {/* Aba 9: Impressora Elgin */}\n          ' + curFileMod.substring(elginIdx);

fs.writeFileSync('src/pages/SettingsPage.tsx', newContent, 'utf8');
