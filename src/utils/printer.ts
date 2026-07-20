import type { OrderDocument } from '../types/order';

export interface PrinterSettings {
  method: 'browser' | 'bluetooth';
  paperSize: '58mm' | '80mm';
  autoPrintOnNew: boolean;
  autoPrintOnAccept: boolean;
  autoPrintOnReady: boolean;
  copies: number;
}

const STORAGE_KEY = 'donalu_printer_settings';

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  method: 'browser',
  paperSize: '58mm',
  autoPrintOnNew: false,
  autoPrintOnAccept: true,
  autoPrintOnReady: false,
  copies: 1,
};

// Global variables for active Web Bluetooth connection
let activeBluetoothDevice: any = null;
let activeBluetoothCharacteristic: any = null;

// Listeners for Bluetooth connection changes
type ConnectionCallback = (connected: boolean, name?: string) => void;
const connectionListeners: Set<ConnectionCallback> = new Set();

export function getPrinterSettings(): PrinterSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_PRINTER_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('Erro ao ler configurações de impressão:', e);
  }
  return DEFAULT_PRINTER_SETTINGS;
}

export function savePrinterSettings(settings: PrinterSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Erro ao salvar configurações de impressão:', e);
  }
}

// Bluetooth State Listeners
export function subscribeToBluetoothState(callback: ConnectionCallback) {
  connectionListeners.add(callback);
  // Initial fire
  callback(isBluetoothConnected(), getConnectedDeviceName());
  return () => {
    connectionListeners.delete(callback);
  };
}

function notifyConnectionListeners() {
  const connected = isBluetoothConnected();
  const name = getConnectedDeviceName();
  connectionListeners.forEach(listener => listener(connected, name));
}

// Bluetooth GATT Connection Manager
export async function connectPrinter(): Promise<string> {
  const bluetoothAPI = (navigator as any).bluetooth;
  if (!bluetoothAPI) {
    throw new Error('Web Bluetooth não é suportado neste navegador. Use Google Chrome, Edge ou Opera.');
  }

  try {
    const device = await bluetoothAPI.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '0000ffe0-0000-1000-8000-00805f9b34fb', // Standard BLE Serial Service (FFE0)
        '000018f0-0000-1000-8000-00805f9b34fb', // Alternate common serial BLE service
      ],
    });

    const server = await device.gatt?.connect();
    if (!server) {
      throw new Error('Não foi possível conectar ao servidor GATT do dispositivo.');
    }

    let characteristic: any = null;

    // Try FFE0 primary service first (common for cheap thermal printers)
    try {
      const service = await server.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
      characteristic = await service.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb');
    } catch (e) {
      console.warn('Serviço FFE0 padrão não encontrado, varrendo outros serviços primários...');
      const services = await server.getPrimaryServices();
      for (const service of services) {
        const chars = await service.getCharacteristics();
        for (const char of chars) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            characteristic = char;
            break;
          }
        }
        if (characteristic) break;
      }
    }

    if (!characteristic) {
      throw new Error('Não foi encontrada nenhuma característica de escrita no dispositivo pareado.');
    }

    activeBluetoothDevice = device;
    activeBluetoothCharacteristic = characteristic;

    device.addEventListener('gattserverdisconnected', onDeviceDisconnected);
    notifyConnectionListeners();

    return device.name || 'Impressora Bluetooth';
  } catch (err: any) {
    console.error('Erro na conexão bluetooth:', err);
    throw err;
  }
}

function onDeviceDisconnected() {
  console.log('Impressora bluetooth desconectada do dispositivo.');
  activeBluetoothDevice = null;
  activeBluetoothCharacteristic = null;
  notifyConnectionListeners();
}

export function disconnectPrinter() {
  if (activeBluetoothDevice && activeBluetoothDevice.gatt?.connected) {
    activeBluetoothDevice.gatt.disconnect();
  }
  activeBluetoothDevice = null;
  activeBluetoothCharacteristic = null;
  notifyConnectionListeners();
}

export function isBluetoothConnected(): boolean {
  return !!(activeBluetoothDevice && activeBluetoothDevice.gatt?.connected && activeBluetoothCharacteristic);
}

export function getConnectedDeviceName(): string {
  return activeBluetoothDevice?.name || '';
}

// -------------------------------------------------------------
// Method 1: Standard System Printing (via Hidden Iframe)
// -------------------------------------------------------------
export function printOrderBrowser(order: OrderDocument, settings: PrinterSettings) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'absolute';
  iframe.style.width = '0px';
  iframe.style.height = '0px';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    console.error('Não foi possível acessar o documento do iframe para impressão.');
    return;
  }

  const paperWidth = settings.paperSize === '58mm' ? '56mm' : '78mm';
  const dividerLine = '-'.repeat(settings.paperSize === '80mm' ? 48 : 32);

  const seq = order.dailySeq ? `#${String(order.dailySeq).padStart(2, '0')}` : `#${order.id?.substring(0, 5) || 'NEW'}`;
  const dateStr = new Date(order.createdAt).toLocaleString('pt-BR');

  let typeLabel = 'PEDIDO';
  if (order.orderType === 'delivery') typeLabel = 'ENTREGA (MOTO) 🛵';
  else if (order.orderType === 'dine_in_table') typeLabel = `MESA ${order.tableNumber} 🪑`;
  else if (order.orderType === 'dine_in') typeLabel = 'COMER NO LOCAL 🍽️';
  else if (order.orderType === 'pickup') typeLabel = 'RETIRADA (VIAGEM) 🏪';

  let itemsHtml = '';
  order.items.forEach(item => {
    const qtyStr = `${item.quantity}x `;
    const priceStr = `R$ ${((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}`;

    itemsHtml += `
      <div class="item-row">
        <span>${qtyStr}<strong>${item.name}</strong></span>
        <span>${priceStr}</span>
      </div>
    `;

    if (item.withCatupiry || item.withBorda || (item.ingredients && item.ingredients.length > 0)) {
      itemsHtml += `<div class="item-details">`;
      if (item.withCatupiry) itemsHtml += `<div>+ Catupiry</div>`;
      if (item.withBorda) itemsHtml += `<div>+ Borda Recheada</div>`;
      if (item.ingredients && item.ingredients.length > 0) {
        itemsHtml += `<div>Adicionais/Ingr: ${item.ingredients.join(', ')}</div>`;
      }
      itemsHtml += `</div>`;
    }
  });

  let addressHtml = '';
  if (order.orderType === 'delivery' && order.address) {
    addressHtml = `
      <div class="section-title">ENDEREÇO DE ENTREGA</div>
      <div><strong>Rua:</strong> ${order.address.street}, ${order.address.number}</div>
      ${order.address.complement ? `<div><strong>Compl:</strong> ${order.address.complement}</div>` : ''}
      <div><strong>Bairro:</strong> ${order.address.neighborhood}</div>
      <div><strong>Cidade:</strong> ${order.address.city}</div>
      <div class="divider">${dividerLine}</div>
    `;
  }

  let paymentLabel = order.paymentMethod ? order.paymentMethod.toUpperCase() : 'NÃO INFORMADO';
  if (order.paymentMethod === 'pix') paymentLabel = 'PIX (Pago Online)';
  else if (order.paymentMethod === 'credito') paymentLabel = 'CARTÃO CRÉDITO';
  else if (order.paymentMethod === 'debito') paymentLabel = 'CARTÃO DÉBITO';
  else if (order.paymentMethod === 'dinheiro') {
    paymentLabel = 'DINHEIRO';
    if (order.changeFor) {
      paymentLabel += ` (Troco para R$ ${order.changeFor.toFixed(2).replace('.', ',')})`;
    }
  }

  const htmlContent = `
    <html>
      <head>
        <title>Pedido ${seq}</title>
        <style>
          @page {
            margin: 0;
            size: auto;
          }
          body {
            margin: 0;
            padding: 4mm 2mm 8mm 2mm;
            font-family: 'Courier New', Courier, monospace;
            font-size: 11px;
            width: ${paperWidth};
            color: #000;
            background: #fff;
            box-sizing: border-box;
          }
          .center {
            text-align: center;
          }
          .bold {
            font-weight: bold;
          }
          .header-title {
            font-size: 16px;
            margin-bottom: 2px;
          }
          .divider {
            border-top: 1px dashed #000;
            margin: 6px 0;
            font-size: 8px;
          }
          .seq-box {
            font-size: 28px;
            font-weight: bold;
            border: 2px solid #000;
            padding: 6px;
            margin: 6px auto;
            width: fit-content;
            text-align: center;
          }
          .item-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 4px;
            font-size: 11px;
          }
          .item-details {
            margin-left: 10px;
            font-size: 9px;
            font-weight: bold;
            margin-bottom: 6px;
          }
          .section-title {
            font-weight: bold;
            margin-top: 6px;
            margin-bottom: 2px;
            text-transform: uppercase;
          }
          .right {
            text-align: right;
          }
          .total-row {
            font-size: 14px;
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            margin-top: 6px;
          }
          .footer {
            margin-top: 12px;
            font-size: 9px;
          }
        </style>
      </head>
      <body>
        <div class="center">
          <div class="header-title bold">DONA LU PASTELARIA</div>
          <div>Sabor e Qualidade</div>
          <div class="divider">${dividerLine}</div>
          <div class="seq-box">${seq}</div>
          <div class="divider">${dividerLine}</div>
        </div>
        
        <div>
          <div><strong>Data:</strong> ${dateStr}</div>
          <div><strong>Cliente:</strong> ${order.clientName}</div>
          ${order.clientPhone ? `<div><strong>Tel:</strong> ${order.clientPhone}</div>` : ''}
          <div><strong>Tipo:</strong> ${typeLabel}</div>
          <div class="divider">${dividerLine}</div>
        </div>

        <div class="section-title">ITENS DO PEDIDO</div>
        <div>
          ${itemsHtml}
        </div>
        <div class="divider">${dividerLine}</div>

        ${addressHtml}

        <div class="right">
          ${(order.deliveryFee ?? 0) > 0 ? `<div>Taxa Entrega: R$ ${(order.deliveryFee ?? 0).toFixed(2).replace('.', ',')}</div>` : ''}
          ${(order.serviceFee ?? 0) > 0 ? `<div>Taxa Serviço (10%): R$ ${(order.serviceFee ?? 0).toFixed(2).replace('.', ',')}</div>` : ''}
          <div class="total-row">
            <span>TOTAL:</span>
            <span>R$ ${order.total.toFixed(2).replace('.', ',')}</span>
          </div>
          <div style="margin-top: 4px;"><strong>Pagamento:</strong> ${paymentLabel}</div>
        </div>
        <div class="divider">${dividerLine}</div>

        <div class="center footer">
          <div>Obrigado pela preferência!</div>
          <div class="bold">Dona Lu - Feito com Amor</div>
        </div>
      </body>
    </html>
  `;

  doc.open();
  doc.write(htmlContent);
  doc.close();

  setTimeout(() => {
    if (iframe.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    }
  }, 350);
}

// -------------------------------------------------------------
// Method 2: Direct Bluetooth ESC/POS Printing
// -------------------------------------------------------------
function encodeEscPos(order: OrderDocument, settings: PrinterSettings): Uint8Array {
  const encoder = new TextEncoder();
  const buffer: number[] = [];

  // ESC/POS Commands
  const INIT = [0x1B, 0x40];
  const ALIGN_CENTER = [0x1B, 0x61, 0x01];
  const ALIGN_LEFT = [0x1B, 0x61, 0x00];
  const ALIGN_RIGHT = [0x1B, 0x61, 0x02];
  const BOLD_ON = [0x1B, 0x45, 0x01];
  const BOLD_OFF = [0x1B, 0x45, 0x00];
  const DOUBLE_SIZE_ON = [0x1D, 0x21, 0x11];
  const DOUBLE_SIZE_OFF = [0x1D, 0x21, 0x00];
  const LINE_FEED = [0x0A];

  const write = (text: string) => {
    // Strip Portuguese accents to make sure it prints nicely on all thermal devices without font maps
    const cleanText = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^ -~\n\r\t]/g, ''); // Keep only printables
    const bytes = encoder.encode(cleanText);
    buffer.push(...Array.from(bytes));
  };

  const writeLine = (text: string = '') => {
    write(text);
    buffer.push(...LINE_FEED);
  };

  const divider = () => {
    const width = settings.paperSize === '80mm' ? 48 : 32;
    writeLine('-'.repeat(width));
  };

  // 1. Initialize
  buffer.push(...INIT);

  // 2. Header
  buffer.push(...ALIGN_CENTER, ...BOLD_ON);
  writeLine('DONA LU PASTELARIA');
  buffer.push(...BOLD_OFF);
  writeLine('Sabor e Qualidade');
  divider();

  // 3. Sequence Number (Double Height/Width)
  buffer.push(...ALIGN_CENTER, ...BOLD_ON, ...DOUBLE_SIZE_ON);
  const seq = order.dailySeq ? `#${String(order.dailySeq).padStart(2, '0')}` : `#${order.id?.substring(0, 5) || 'NEW'}`;
  writeLine(seq);
  buffer.push(...DOUBLE_SIZE_OFF, ...BOLD_OFF);
  divider();

  // 4. Client Metadata
  buffer.push(...ALIGN_LEFT);
  writeLine(`Data: ${new Date(order.createdAt).toLocaleString('pt-BR')}`);
  writeLine(`Cliente: ${order.clientName}`);
  if (order.clientPhone) {
    writeLine(`Tel: ${order.clientPhone}`);
  }

  let typeLabel = 'PEDIDO';
  if (order.orderType === 'delivery') typeLabel = 'ENTREGA (MOTO)';
  else if (order.orderType === 'dine_in_table') typeLabel = `MESA ${order.tableNumber}`;
  else if (order.orderType === 'dine_in') typeLabel = 'COMER NO LOCAL';
  else if (order.orderType === 'pickup') typeLabel = 'RETIRADA (VIAGEM)';
  writeLine(`Tipo: ${typeLabel}`);
  divider();

  // 5. Items
  buffer.push(...BOLD_ON);
  writeLine('ITENS DO PEDIDO');
  buffer.push(...BOLD_OFF);

  order.items.forEach(item => {
    const qtyStr = `${item.quantity}x `;
    const priceStr = `R$ ${((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}`;

    const maxChars = settings.paperSize === '80mm' ? 48 : 32;
    const nameLen = maxChars - qtyStr.length - priceStr.length;
    let nameStr = item.name;
    if (nameStr.length > nameLen) {
      nameStr = nameStr.substring(0, nameLen - 3) + '...';
    }
    const padSize = nameLen - nameStr.length;
    writeLine(`${qtyStr}${nameStr}${' '.repeat(padSize > 0 ? padSize : 0)}${priceStr}`);

    if (item.withCatupiry) {
      writeLine('  + Catupiry');
    }
    if (item.withBorda) {
      writeLine('  + Borda Recheada');
    }
    if (item.ingredients && item.ingredients.length > 0) {
      writeLine(`  Ingr: ${item.ingredients.join(', ')}`);
    }
  });
  divider();

  // 6. Address
  if (order.orderType === 'delivery' && order.address) {
    buffer.push(...BOLD_ON);
    writeLine('ENDERECO DE ENTREGA');
    buffer.push(...BOLD_OFF);
    writeLine(`${order.address.street}, ${order.address.number}`);
    if (order.address.complement) {
      writeLine(`Compl: ${order.address.complement}`);
    }
    writeLine(`Bairro: ${order.address.neighborhood}`);
    writeLine(`Cidade: ${order.address.city}`);
    divider();
  }

  // 7. Totaling
  buffer.push(...ALIGN_RIGHT);
  if (order.deliveryFee && order.deliveryFee > 0) {
    writeLine(`Taxa Entrega: R$ ${order.deliveryFee.toFixed(2).replace('.', ',')}`);
  }
  if (order.serviceFee && order.serviceFee > 0) {
    writeLine(`Taxa Servico: R$ ${order.serviceFee.toFixed(2).replace('.', ',')}`);
  }

  buffer.push(...BOLD_ON);
  writeLine(`TOTAL: R$ ${order.total.toFixed(2).replace('.', ',')}`);
  buffer.push(...BOLD_OFF);

  if (order.paymentMethod) {
    let methodLabel = order.paymentMethod.toUpperCase();
    if (order.paymentMethod === 'pix') methodLabel = 'PIX (Pago Online)';
    else if (order.paymentMethod === 'credito') methodLabel = 'CARTAO CREDITO';
    else if (order.paymentMethod === 'debito') methodLabel = 'CARTAO DEBITO';
    else if (order.paymentMethod === 'dinheiro') {
      methodLabel = 'DINHEIRO';
      if (order.changeFor) {
        methodLabel += ` (Troco p/ R$ ${order.changeFor.toFixed(2).replace('.', ',')})`;
      }
    }
    writeLine(`Pagamento: ${methodLabel}`);
  }
  buffer.push(...ALIGN_CENTER);
  divider();

  // 8. Footer Feed
  writeLine('Obrigado pela preferencia!');
  writeLine('Dona Lu - Feito com Amor');
  buffer.push(...LINE_FEED, ...LINE_FEED, ...LINE_FEED, ...LINE_FEED);

  // Paper Cut Command
  buffer.push(0x1D, 0x56, 0x42, 0x00);

  return new Uint8Array(buffer);
}

export async function printOrderBluetooth(order: OrderDocument, settings: PrinterSettings): Promise<void> {
  if (!isBluetoothConnected() || !activeBluetoothCharacteristic) {
    throw new Error('A impressora Bluetooth está desconectada. Conecte-a nas Configurações.');
  }

  try {
    const data = encodeEscPos(order, settings);
    // Write in chunks of 20 bytes to prevent packet drops or GATT errors
    const chunkSize = 20;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      await activeBluetoothCharacteristic.writeValue(chunk);
      // Small pause to let printer process buffer
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  } catch (err: any) {
    console.error('Erro ao enviar dados para a impressora:', err);
    throw new Error('Falha ao enviar dados de impressão. Reconecte a impressora.');
  }
}

// -------------------------------------------------------------
// High-Level Print Orchestrator
// -------------------------------------------------------------
export async function printOrder(order: OrderDocument): Promise<void> {
  const settings = getPrinterSettings();
  const loopCount = Math.max(1, settings.copies);

  for (let i = 0; i < loopCount; i++) {
    if (settings.method === 'browser') {
      printOrderBrowser(order, settings);
    } else {
      await printOrderBluetooth(order, settings);
    }
  }
}

// -------------------------------------------------------------
// Test Print Support
// -------------------------------------------------------------
export async function printMockOrder(): Promise<void> {
  const mockOrder: OrderDocument = {
    id: 'TESTE-9999',
    clientName: 'Cliente de Teste Dona Lu',
    clientPhone: '(21) 99999-9999',
    createdAt: new Date().toISOString(),
    orderType: 'delivery',
    dailySeq: 88,
    items: [
      { id: 1, name: 'Pastel Especial de Carne', price: 18.0, quantity: 2, ingredients: ['Ovo', 'Azeitona'] },
      { id: 2, name: 'Pastel Calabresa c/ Catupiry', price: 16.5, quantity: 1, withCatupiry: true },
      { id: 3, name: 'Caldo de Cana 500ml', price: 8.0, quantity: 2 },
    ],
    total: 68.5,
    deliveryFee: 7.0,
    paymentMethod: 'dinheiro',
    changeFor: 100.0,
    status: 'pending',
    clientUid: 'mock-uid',
    address: {
      street: 'Avenida Cesário de Melo',
      number: '1500',
      neighborhood: 'Campo Grande',
      city: 'Rio de Janeiro',
      zipCode: '23080-300',
      complement: 'Apto 101',
    },
  };
  return printOrder(mockOrder);
}
