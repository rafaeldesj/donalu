const fs = require('fs');
const cp = require('child_process');

const headFile = cp.execSync('git show HEAD:src/pages/SettingsPage.tsx').toString('utf8');
let curFile = fs.readFileSync('src/pages/SettingsPage.tsx.bak', 'utf8');

// 1. Get original printer block from HEAD
const startIdx = headFile.indexOf("{activeTab === 'printer' && (isAdmin || role === 'staff') && (");
const endIdx = headFile.indexOf("</main>", startIdx);
let printerBlock = headFile.substring(startIdx, endIdx);

// Modify printerBlock to say "Bluetooth" instead of "Térmica"
printerBlock = printerBlock.replace("Configuração da Impressora Térmica", "Configuração da Impressora Térmica Bluetooth");

// 2. In curFile, rename the current 'printer' block to 'elgin_i8'
// The curFile currently has the elgin layout but it's bound to activeTab === 'printer'
curFile = curFile.replace(
    "{activeTab === 'printer' && (isAdmin || role === 'staff') && (",
    "{activeTab === 'elgin_i8' && (isAdmin || role === 'staff') && ("
);

// 3. Inject original printerBlock right before elgin_i8 block
const elginIdx = curFile.indexOf("{activeTab === 'elgin_i8' && (isAdmin || role === 'staff') && (");
let newContent = curFile.substring(0, elginIdx) + printerBlock + '\n          {/* Aba 9: Impressora Elgin */}\n          ' + curFile.substring(elginIdx);

// Also need to make sure the sidebar buttons are correct.
// In curFile (which comes from bak), the sidebar has 'printer' button. We need to add 'elgin_i8' button.
const printerBtnStr = `          {(isAdmin || role === 'staff') && (
            <button
              type="button"
              onClick={() => setActiveTab('printer')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: activeTab === 'printer' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                background: activeTab === 'printer' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                color: activeTab === 'printer' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textAlign: 'left'
              }}
            >
              <Printer size={18} />
              Impressora Bluetooth
            </button>
          )}`;

const elginBtnStr = `
          {(isAdmin || role === 'staff') && (
            <button
              type="button"
              onClick={() => setActiveTab('elgin_i8')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: activeTab === 'elgin_i8' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                background: activeTab === 'elgin_i8' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                color: activeTab === 'elgin_i8' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textAlign: 'left'
              }}
            >
              <Printer size={18} />
              Impressora Bematech Elgin i8
            </button>
          )}`;

// First remove any existing elgin_i8 button if it somehow got there
if (!newContent.includes("onClick={() => setActiveTab('elgin_i8')}")) {
    newContent = newContent.replace(printerBtnStr, printerBtnStr + elginBtnStr);
}

// Ensure activeTab type has elgin_i8
if (!newContent.includes("'printer' | 'elgin_i8'")) {
    newContent = newContent.replace("'payments' | 'printer'>", "'payments' | 'printer' | 'elgin_i8'>");
}

fs.writeFileSync('src/pages/SettingsPage.tsx', newContent, 'utf8');
console.log('Done!');
