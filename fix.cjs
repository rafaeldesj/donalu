const fs = require('fs');
const oldFile = fs.readFileSync('SettingsPage_old.tsx', 'utf8');
let curFile = fs.readFileSync('src/pages/SettingsPage.tsx', 'utf8');

// The curFile got messed up because I injected into line 949.
// Let's restore curFile to its backup from before the injection
curFile = fs.readFileSync('src/pages/SettingsPage.tsx.bak', 'utf8');

// Now, in curFile, replace the first '{activeTab === \'printer\' && (isAdmin || role === \'staff\') && ('
// with '{activeTab === \'elgin_i8\' && (isAdmin || role === \'staff\') && ('
// This is because we renamed it to elgin_i8 in the backup.
curFile = curFile.replace(
    "{activeTab === 'printer' && (isAdmin || role === 'staff') && (",
    "{activeTab === 'elgin_i8' && (isAdmin || role === 'staff') && ("
);

// Now extract the printer block from oldFile
const startIdx = oldFile.indexOf("{activeTab === 'printer' && (isAdmin || role === 'staff') && (");
let endIdx = oldFile.indexOf("</main>", startIdx);
const printerBlock = oldFile.substring(startIdx, endIdx);

// Now inject printerBlock into curFile right before the elgin_i8 block
const elginIdx = curFile.indexOf("{activeTab === 'elgin_i8' && (isAdmin || role === 'staff') && (");

const newContent = curFile.substring(0, elginIdx) + printerBlock + '\n          {/* Aba 9: Impressora Elgin */}\n          ' + curFile.substring(elginIdx);

fs.writeFileSync('src/pages/SettingsPage.tsx', newContent, 'utf8');
