const fs = require('fs');
const oldFile = fs.readFileSync('SettingsPage_old.tsx', 'utf8');
const curFile = fs.readFileSync('src/pages/SettingsPage.tsx.bak', 'utf8');

const startStr = "{activeTab === 'printer' && (isAdmin || role === 'staff') && (";
const startIdx = oldFile.indexOf(startStr);
console.log('oldFile startIdx:', startIdx);
let endIdx = oldFile.indexOf("</main>", startIdx);
console.log('oldFile endIdx:', endIdx);

const printerBlock = oldFile.substring(startIdx, endIdx);
console.log('printerBlock length:', printerBlock.length);

let curFileMod = curFile.replace(
    startStr,
    "{activeTab === 'elgin_i8' && (isAdmin || role === 'staff') && ("
);

const elginStr = "{activeTab === 'elgin_i8' && (isAdmin || role === 'staff') && (";
const elginIdx = curFileMod.indexOf(elginStr);
console.log('curFileMod elginIdx:', elginIdx);

if (startIdx !== -1 && endIdx !== -1 && elginIdx !== -1) {
    const newContent = curFileMod.substring(0, elginIdx) + printerBlock + '\n          {/* Aba 9: Impressora Elgin */}\n          ' + curFileMod.substring(elginIdx);
    fs.writeFileSync('src/pages/SettingsPage.tsx', newContent, 'utf8');
    console.log('SUCCESS');
} else {
    console.log('FAILED');
}
