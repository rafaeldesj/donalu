import type { OrderDocument } from '../types/order';

export interface PrinterSettings {
  method: 'browser' | 'bluetooth' | 'serial' | 'ethernet';
  paperSize: '58mm' | '80mm';
  autoPrintOnNew: boolean;
  autoPrintOnAccept: boolean;
  autoPrintOnReady: boolean;
  copies: number;
  baudRate?: number;
}

const STORAGE_KEY = 'donalu_printer_settings';

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  method: 'browser',
  paperSize: '58mm',
  autoPrintOnNew: false,
  autoPrintOnAccept: true,
  autoPrintOnReady: false,
  copies: 1,
  baudRate: 9600,
};

// Global variables for active Web Bluetooth connection
let activeBluetoothDevice: any = null;
let activeBluetoothCharacteristic: any = null;

// Listeners for Bluetooth connection changes
type ConnectionCallback = (connected: boolean, name?: string) => void;
const connectionListeners: Set<ConnectionCallback> = new Set();

// Global variables for active Web Serial connection
let activeSerialPort: any = null;

// Listeners for Serial connection changes
type SerialConnectionCallback = (connected: boolean, name?: string) => void;
const serialConnectionListeners: Set<SerialConnectionCallback> = new Set();

if (typeof navigator !== 'undefined' && (navigator as any).serial) {
  (navigator as any).serial.addEventListener('disconnect', (event: any) => {
    if (activeSerialPort && event.port === activeSerialPort) {
      activeSerialPort = null;
      notifySerialConnectionListeners();
    }
  });
}

export function subscribeToSerialState(callback: SerialConnectionCallback) {
  serialConnectionListeners.add(callback);
  callback(isSerialConnected(), getConnectedSerialName());
  return () => {
    serialConnectionListeners.delete(callback);
  };
}

function notifySerialConnectionListeners() {
  const connected = isSerialConnected();
  const name = getConnectedSerialName();
  serialConnectionListeners.forEach(listener => listener(connected, name));
}

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
// Web Serial Connection Manager (USB / Serial Cable)
// -------------------------------------------------------------
export async function connectSerial(baudRate?: number): Promise<string> {
  const serialAPI = (navigator as any).serial;
  if (!serialAPI) {
    throw new Error('Web Serial não é suportado neste navegador. Use Google Chrome, Edge ou Opera no computador.');
  }

  try {
    const port = await serialAPI.requestPort();
    const settings = getPrinterSettings();
    const selectedBaudRate = baudRate || settings.baudRate || 9600;
    await port.open({ baudRate: selectedBaudRate });
    
    // Configurar DTR e RTS para true. Muitas impressoras térmicas USB/Serial requerem esses sinais.
    try {
      await port.setSignals({ dataTerminalReady: true, requestToSend: true });
    } catch (sigErr) {
      console.warn('Não foi possível definir sinais DTR/RTS na porta serial:', sigErr);
    }
    
    activeSerialPort = port;
    notifySerialConnectionListeners();
    return 'Impressora USB (Serial)';
  } catch (err: any) {
    console.error('Erro na conexão Serial/USB:', err);
    throw err;
  }
}

export async function disconnectSerial() {
  if (activeSerialPort) {
    try {
      await activeSerialPort.close();
    } catch (e) {
      console.error('Erro ao fechar porta serial:', e);
    }
  }
  activeSerialPort = null;
  notifySerialConnectionListeners();
}

export function isSerialConnected(): boolean {
  return !!activeSerialPort;
}

export function getConnectedSerialName(): string {
  return activeSerialPort ? 'Impressora USB/Serial' : '';
}

// -------------------------------------------------------------
// Method 1: Standard System Printing (via Hidden Iframe)
// -------------------------------------------------------------
export function printOrderBrowser(order: OrderDocument, settings: PrinterSettings, summaryOnly: boolean = false) {
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

    if (item.withCatupiry || item.cheeseOption || item.withBorda || item.bordaType || item.sweetChocolateOption || item.sweetCheeseOption || (item.ingredients && item.ingredients.length > 0)) {
      itemsHtml += `<div class="item-details">`;
      if (item.cheeseOption === 'catupiry' || item.withCatupiry) itemsHtml += `<div>+ Catupiry</div>`;
      else if (item.cheeseOption === 'cheddar') itemsHtml += `<div>+ Cheddar</div>`;
      else if (item.cheeseOption === 'cream_cheese') itemsHtml += `<div>+ Cream Cheese</div>`;

      if (item.sweetChocolateOption === 'preto') itemsHtml += `<div>+ Chocolate Preto</div>`;
      else if (item.sweetChocolateOption === 'branco') itemsHtml += `<div>+ Chocolate Branco</div>`;

      if (item.sweetCheeseOption === 'minas') itemsHtml += `<div>+ Queijo Minas</div>`;
      else if (item.sweetCheeseOption === 'mussarela') itemsHtml += `<div>+ Queijo Mussarela</div>`;

      if (item.bordaType === 'queijo' || item.withBorda) itemsHtml += `<div>+ Borda de Queijo</div>`;
      else if (item.bordaType === 'kitkat_preto') itemsHtml += `<div>+ Borda Kit-Kat Preto</div>`;
      else if (item.bordaType === 'kitkat_branco') itemsHtml += `<div>+ Borda Kit-Kat Branco</div>`;
      else if (item.bordaType === 'kitkat') itemsHtml += `<div>+ Borda Kit-Kat</div>`;
      else if (item.bordaType === 'sem_borda') itemsHtml += `<div>+ Sem Borda</div>`;

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

  let individualSlipsHtml = '';

  if (!summaryOnly) {
    const foods = order.items.filter(item => item.category !== 'Bebidas');
    const beverages = order.items.filter(item => item.category === 'Bebidas');

    const slips: { type: 'food' | 'beverages'; items: typeof order.items }[] = [];
    foods.forEach(item => {
      slips.push({ type: 'food', items: [item] });
    });
    if (beverages.length > 0) {
      slips.push({ type: 'beverages', items: beverages });
    }

    slips.forEach(slip => {
      let itemAddressHtml = '';
      if (order.orderType === 'delivery' && order.address) {
        itemAddressHtml = `
          <div><strong>ENDEREÇO:</strong> ${order.address.street}, ${order.address.number}</div>
          ${order.address.complement ? `<div><strong>COMPL:</strong> ${order.address.complement}</div>` : ''}
        `;
      }

      const spacerHtml = `
        <div style="width: 100%; border-top: 1px dashed #000; margin: 10px 0;"></div>
      `;

      let itemsListHtml = '';
      slip.items.forEach(item => {
        itemsListHtml += `
          <div style="font-size: 12px; margin-top: 6px;">
            ${item.quantity}x <strong>${item.name}</strong>
          </div>
        `;
      });

      individualSlipsHtml += `
        ${spacerHtml}
        <div style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: 600;">
          <div class="bold">================================</div>
          <br><br><br><br><br><br><br><br><br><br>
          <div><strong>PEDIDO:</strong> ${seq}</div>
          <div><strong>CLIENTE:</strong> ${order.clientName}</div>
          ${order.clientPhone ? `<div><strong>TEL:</strong> ${order.clientPhone}</div>` : ''}
          ${itemAddressHtml}
          <div class="bold">--------------------------------</div>
          ${itemsListHtml}
        </div>
      `;
    });
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
            font-family: Arial, Helvetica, sans-serif;
            font-size: 12px;
            font-weight: 600;
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
            font-size: 12px;
          }
          .item-details {
            margin-left: 10px;
            font-size: 10px;
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

        <div class="center footer" style="margin-top: 15px; line-height: 1.4;">
          <div>donalu.web.app</div>
          <div style="margin: 4px 0;"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAAAklEQVR4AewaftIAAANhSURBVO3BUU4sSRAEQfdU3//KsXyWSmiKnqWBl0oz84HRVjFaK0ZrxWitGK1dfELltyThLpWTJOxUTpJwl8pvScKqGK0Vo7VitHbxBUl4isorKrskPCEJJyqrJJwk4SkqrxSjtWK0VozWitHaxZtU7krCE5LwjiScqDxB5a4k3FWM1orRWjFau/gHqdyVhJ3KSRJWKv+SYrRWjNaK0VoxWrv445JworJLwl1J6KYYrRWjtWK0dvGmJPwWlbtUTlR2SXhCEn5CMVorRmvFaK0YrV18gcpvUdklYaXyjiSsVJ6g8luK0VoxWitGa+YDf5jKSRJ2KqskvEPllST8ZcVorRitFaO1i0+orJLwFJVVEk6ScJfKE1ROknCi8o4kvFKM1orRWjFaK0Zr5gPfQOUkCScq3yEJd6mcJOEulack4ZVitFaM1orR2sUnVH6KyitJ+ClJ2Km8orJLwioJJyq7JKxUdiqrJKyK0VoxWitGa8Vo7eILkrBTWSVhp7JS2SVhpbJSOUnCTuUkCSuVE5W7VHZJuCsJO5VXitFaMVorRmvmAwcqPyUJd6nskvAElVUSdionSfgOKqskrIrRWjFaK0ZrxWjt4hMqdyVhp3KShFdUdklYJeFEZZeElcpJEk6SsFL5Diq7JLxSjNaK0VoxWjMf2KiskvAUlVeSsFM5ScJ3ULkrCSuVdyRhpXKShFUxWitGa8VorRitXXwTlXckYaWyUtklYaVyorJLwkpll4QnJGGlslNZJWGn8koxWitGa8Vo7eJNKqsknKjsVFZJ+CkqJypPUFklYadykoRXitFaMVorRmvmA3+Yyi4JT1C5KwnvUFkl4QnFaK0YrRWjtWK0dvEJld+ShFUSvoPKO5KwUjlRWSXhKSqrJKyK0VoxWitGaxdfkISnqNylclcS3qFyVxJ+ShJeKUZrxWitGK0Vo7WLN6nclYTvkISVym9ReYrKXUlYFaO1YrRWjNYu/kEqJ0lYqbwjCSuVu5LwjiSsVO4qRmvFaK0YrRWjtYt/UBLuSsJO5f9KwndQOUnCTuWVYrRWjNaK0drFm5LwW1ROkrBSOUnCd1C5KwlPKEZrxWitGK0Vo7WLL1D5LSq7JJyo/BVJOFHZJeH/KkZrxWitGK2ZD4y2itFaMVorRmv/AQ1+Xh3q4NYlAAAAAElFTkSuQmCC" width="100" /></div>
          <br>
          <div>Obrigado pela preferência!</div>
          <div class="bold">Dona Lu - Feito com Amor</div>
          <br>
          <div style="font-weight: bold;">Desenvolvedor Responsável</div>
          <div style="font-weight: bold;">Rafael Jorge (21) 99565-5031 WPP</div>
        </div>

        <!-- Cupons Individuais de Cozinha -->
        ${individualSlipsHtml}

        <!-- Footer Personalizado -->
        <div style="display: block; clear: both; text-align: center; font-size: 11px; font-weight: bold; margin-top: 15px; line-height: 1.4;">
          <div>donalu.web.app</div>
          <div style="margin: 4px 0;"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAYAAAA5ZDbSAAAAAklEQVR4AewaftIAAANhSURBVO3BUU4sSRAEQfdU3//KsXyWSmiKnqWBl0oz84HRVjFaK0ZrxWitGK1dfELltyThLpWTJOxUTpJwl8pvScKqGK0Vo7VitHbxBUl4isorKrskPCEJJyqrJJwk4SkqrxSjtWK0VozWitHaxZtU7krCE5LwjiScqDxB5a4k3FWM1orRWjFau/gHqdyVhJ3KSRJWKv+SYrRWjNaK0VoxWrv445JworJLwl1J6KYYrRWjtWK0dvGmJPwWlbtUTlR2SXhCEn5CMVorRmvFaK0YrV18gcpvUdklYaXyjiSsVJ6g8luK0VoxWitGa+YDf5jKSRJ2KqskvEPllST8ZcVorRitFaO1i0+orJLwFJVVEk6ScJfKE1ROknCi8o4kvFKM1orRWjFaK0Zr5gPfQOUkCScq3yEJd6mcJOEulack4ZVitFaM1orR2sUnVH6KyitJ+ClJ2Km8orJLwioJJyq7JKxUdiqrJKyK0VoxWitGa8Vo7eILkrBTWSVhp7JS2SVhpbJSOUnCTuUkCSuVE5W7VHZJuCsJO5VXitFaMVorRmvmAwcqPyUJd6nskvAElVUSdionSfgOKqskrIrRWjFaK0ZrxWjt4hMqdyVhp3KShFdUdklYJeFEZZeElcpJEk6SsFL5Diq7JLxSjNaK0VoxWjMf2KiskvAUlVeSsFM5ScJ3ULkrCSuVdyRhpXKShFUxWitGa8VorRitXXwTlXckYaWyUtklYaVyorJLwkpll4QnJGGlslNZJWGn8koxWitGa8Vo7eJNKqsknKjsVFZJ+CkqJypPUFklYadykoRXitFaMVorRmvmA3+Yyi4JT1C5KwnvUFkl4QnFaK0YrRWjtWK0dvEJld+ShFUSvoPKO5KwUjlRWSXhKSqrJKyK0VoxWitGaxdfkISnqNylclcS3qFyVxJ+ShJeKUZrxWitGK0Vo7WLN6nclYTvkISVym9ReYrKXUlYFaO1YrRWjNYu/kEqJ0lYqbwjCSuVu5LwjiSsVO4qRmvFaK0YrRWjtYt/UBLuSsJO5f9KwndQOUnCTuWVYrRWjNaK0drFm5LwW1ROkrBSOUnCd1C5KwlPKEZrxWitGK0Vo7WLL1D5LSq7JJyo/BVJOFHZJeH/KkZrxWitGK2ZD4y2itFaMVorRmv/AQ1+Xh3q4NYlAAAAAElFTkSuQmCC" width="100" /></div>
          <br>
          <div>Obrigado pela preferência!</div>
          <div>Dona Lu - Feito com Amor</div>
          <br>
          <div>Desenvolvedor Responsável</div>
          <div>Rafael Jorge (21) 99565-5031 WPP</div>
          <br>
          <div style="border-top: 1px dashed #000; margin-top: 5px;"></div>
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

// Helper to wrap text to a specific character limit per line
function wrapText(text: string, limit: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  words.forEach(word => {
    if ((currentLine + word).length + (currentLine ? 1 : 0) <= limit) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
      // If the word itself is longer than limit, break it down
      while (currentLine.length > limit) {
        lines.push(currentLine.substring(0, limit));
        currentLine = currentLine.substring(limit);
      }
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

// -------------------------------------------------------------
// Method 2: Direct Bluetooth ESC/POS Printing
// -------------------------------------------------------------
function encodeEscPos(order: OrderDocument, settings: PrinterSettings, summaryOnly: boolean = false): Uint8Array {
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

    if (item.name.length <= nameLen) {
      const padSize = nameLen - item.name.length;
      writeLine(`${qtyStr}${item.name}${' '.repeat(padSize > 0 ? padSize : 0)}${priceStr}`);
    } else {
      // Wrap name to maxChars - 3 (to account for qtyStr and indentation)
      const wrappedName = wrapText(item.name, maxChars - 3);
      writeLine(`${qtyStr}${wrappedName[0]}`);
      for (let i = 1; i < wrappedName.length; i++) {
        writeLine(`   ${wrappedName[i]}`);
      }
      // Print price right-aligned on the next line
      writeLine(`${' '.repeat(maxChars - priceStr.length)}${priceStr}`);
    }

    if (item.cheeseOption === 'catupiry' || item.withCatupiry) {
      writeLine('  + Catupiry');
    } else if (item.cheeseOption === 'cheddar') {
      writeLine('  + Cheddar');
    } else if (item.cheeseOption === 'cream_cheese') {
      writeLine('  + Cream Cheese');
    }

    if (item.sweetChocolateOption === 'preto') writeLine('  + Chocolate Preto');
    else if (item.sweetChocolateOption === 'branco') writeLine('  + Chocolate Branco');

    if (item.sweetCheeseOption === 'minas') writeLine('  + Queijo Minas');
    else if (item.sweetCheeseOption === 'mussarela') writeLine('  + Queijo Mussarela');

    if (item.bordaType === 'queijo' || item.withBorda) {
      writeLine('  + Borda de Queijo');
    } else if (item.bordaType === 'kitkat_preto') {
      writeLine('  + Borda Kit-Kat Preto');
    } else if (item.bordaType === 'kitkat_branco') {
      writeLine('  + Borda Kit-Kat Branco');
    } else if (item.bordaType === 'kitkat') {
      writeLine('  + Borda Kit-Kat');
    } else if (item.bordaType === 'sem_borda') {
      writeLine('  + Sem Borda');
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
  buffer.push(...ALIGN_CENTER);
  writeLine('donalu.web.app');
  
  // Print QR Code
  const qrUrl = 'https://donalu.web.app';
  const urlBytes = encoder.encode(qrUrl);
  const storeLen = urlBytes.length + 3;
  const pL = storeLen % 256;
  const pH = Math.floor(storeLen / 256);
  buffer.push(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // Model 2
  buffer.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06); // Size 6
  buffer.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30); // Error correction
  buffer.push(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30); // Store data
  buffer.push(...Array.from(urlBytes));
  buffer.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30); // Print QR
  
  writeLine('');
  writeLine('Obrigado pela preferencia!');
  writeLine('Dona Lu - Feito com Amor');
  writeLine('');
  writeLine('Desenvolvedor Responsavel');
  writeLine('Rafael Jorge (21) 99565-5031 WPP');
  writeLine('');
  divider();

  // 9. Individual Item slips for Kitchen/Delivery
  if (!summaryOnly) {
    const foods = order.items.filter(item => item.category !== 'Bebidas');
    const beverages = order.items.filter(item => item.category === 'Bebidas');

    const slips: { type: 'food' | 'beverages'; items: typeof order.items }[] = [];
    foods.forEach(item => {
      slips.push({ type: 'food', items: [item] });
    });
    if (beverages.length > 0) {
      slips.push({ type: 'beverages', items: beverages });
    }

    slips.forEach(slip => {
      const maxChars = settings.paperSize === '80mm' ? 48 : 32;
      buffer.push(...ALIGN_CENTER);
      writeLine('- '.repeat(maxChars / 2).trim());
      
      buffer.push(...ALIGN_LEFT, ...BOLD_ON);

      writeLine('='.repeat(maxChars));
      for (let i = 0; i < 10; i++) {
        buffer.push(...LINE_FEED);
      }
      
      writeLine(`PEDIDO: ${seq}`);
      writeLine(`CLIENTE: ${order.clientName}`);
      if (order.clientPhone) {
        writeLine(`TEL: ${order.clientPhone}`);
      }
      if (order.orderType === 'delivery' && order.address) {
        writeLine(`ENDERECO: ${order.address.street}, ${order.address.number}`);
        if (order.address.complement) {
          writeLine(`COMPL: ${order.address.complement}`);
        }
      }
      writeLine('-'.repeat(maxChars));
      buffer.push(...BOLD_OFF);

      // Print all items in the slip (with name wrapping)
      slip.items.forEach(item => {
        const qtyStr = `${item.quantity}x `;
        const wrappedName = wrapText(item.name, maxChars - 3);
        writeLine(`${qtyStr}${wrappedName[0]}`);
        for (let i = 1; i < wrappedName.length; i++) {
          writeLine(`   ${wrappedName[i]}`);
        }
      });
    });
  }

  // Print and feed 8 lines (ESC d 8) to push the text past the tear bar / cutter
  buffer.push(0x1B, 0x64, 0x08);

  // Paper Cut Command (only for 80mm printers which usually have auto-cutters)
  if (settings.paperSize === '80mm') {
    buffer.push(0x1D, 0x56, 0x42, 0x00);
  }

  return new Uint8Array(buffer);
}

export async function printOrderBluetooth(order: OrderDocument, settings: PrinterSettings, summaryOnly: boolean = false): Promise<void> {
  if (!isBluetoothConnected() || !activeBluetoothCharacteristic) {
    throw new Error('A impressora Bluetooth está desconectada. Conecte-a nas Configurações.');
  }

  try {
    const data = encodeEscPos(order, settings, summaryOnly);
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
// Method 3: Direct USB/Serial ESC/POS Printing
// -------------------------------------------------------------
export async function printOrderSerial(order: OrderDocument, settings: PrinterSettings, summaryOnly: boolean = false): Promise<void> {
  if (!isSerialConnected() || !activeSerialPort) {
    throw new Error('A impressora USB está desconectada. Conecte-a nas Configurações.');
  }

  const data = encodeEscPos(order, settings, summaryOnly);
  const writer = activeSerialPort.writable.getWriter();
  try {
    await writer.write(data);
  } catch (err: any) {
    console.error('Erro ao enviar dados para a impressora Serial:', err);
    throw new Error('Falha ao enviar dados de impressão via cabo. Reconecte a impressora.');
  } finally {
    writer.releaseLock();
  }
}

// -------------------------------------------------------------
// High-Level Print Orchestrator
// -------------------------------------------------------------
export async function printOrder(order: OrderDocument, summaryOnly: boolean = false): Promise<void> {
  const settings = getPrinterSettings();
  const loopCount = Math.max(1, settings.copies);

  for (let i = 0; i < loopCount; i++) {
    if (settings.method === 'browser') {
      printOrderBrowser(order, settings, summaryOnly);
    } else if (settings.method === 'bluetooth') {
      await printOrderBluetooth(order, settings, summaryOnly);
    } else if (settings.method === 'serial') {
      await printOrderSerial(order, settings, summaryOnly);
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

// -------------------------------------------------------------
// Table / Client Extrato Bill Printing
// -------------------------------------------------------------
export async function printTableBill(tableNum: string, ordersList: OrderDocument[], targetClientName?: string): Promise<void> {
  const settings = getPrinterSettings();
  if (!ordersList || ordersList.length === 0) return;

  const paperWidth = settings.paperSize === '58mm' ? '56mm' : '78mm';
  const dividerLine = '-'.repeat(settings.paperSize === '80mm' ? 48 : 32);

  const grandTotal = ordersList.reduce((sum, o) => sum + o.total, 0);
  const totalServiceFee = ordersList.reduce((sum, o) => sum + (o.serviceFee || 0), 0);
  const dateStr = new Date().toLocaleString('pt-BR');

  if (settings.method === 'browser') {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    let itemsHtml = '';
    ordersList.forEach(order => {
      order.items.forEach(item => {
        itemsHtml += `
          <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 3px;">
            <span>${item.quantity}x <strong>${item.name}</strong></span>
            <span>R$ ${((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}</span>
          </div>
        `;
        if (item.withCatupiry || item.cheeseOption || item.withBorda || item.bordaType || item.sweetChocolateOption || item.sweetCheeseOption || (item.ingredients && item.ingredients.length > 0)) {
          let details = [];
          if (item.cheeseOption === 'catupiry' || item.withCatupiry) details.push('+ Catupiry');
          else if (item.cheeseOption === 'cheddar') details.push('+ Cheddar');
          else if (item.cheeseOption === 'cream_cheese') details.push('+ Cream Cheese');

          if (item.sweetChocolateOption === 'preto') details.push('+ Chocolate Preto');
          else if (item.sweetChocolateOption === 'branco') details.push('+ Chocolate Branco');

          if (item.sweetCheeseOption === 'minas') details.push('+ Queijo Minas');
          else if (item.sweetCheeseOption === 'mussarela') details.push('+ Queijo Mussarela');

          if (item.bordaType === 'queijo' || item.withBorda) details.push('+ Borda de Queijo');
          else if (item.bordaType === 'kitkat_preto') details.push('+ Borda Kit-Kat Preto');
          else if (item.bordaType === 'kitkat_branco') details.push('+ Borda Kit-Kat Branco');
          else if (item.bordaType === 'kitkat') details.push('+ Borda Kit-Kat');
          else if (item.bordaType === 'sem_borda') details.push('+ Sem Borda');

          if (item.ingredients && item.ingredients.length > 0) details.push(`Ingr: ${item.ingredients.join(', ')}`);
          itemsHtml += `<div style="font-size: 10px; font-weight: bold; margin-left: 10px; margin-bottom: 4px;">${details.join(' | ')}</div>`;
        }
      });
    });

    const titleText = targetClientName ? `CONTA DO CLIENTE: ${targetClientName.toUpperCase()}` : `CONTA DA MESA ${tableNum}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            @page { margin: 0; size: auto; }
            body { margin: 0; padding: 4mm 2mm 8mm 2mm; font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: 600; width: ${paperWidth}; color: #000; background: #fff; }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .header-title { font-size: 16px; margin-bottom: 2px; }
            .divider { border-top: 1px dashed #000; margin: 6px 0; font-size: 8px; }
            .seq-box { font-size: 18px; font-weight: bold; border: 2px solid #000; padding: 4px; margin: 6px auto; width: fit-content; text-align: center; }
            .right { text-align: right; }
            .total-row { font-size: 15px; font-weight: bold; display: flex; justify-content: space-between; margin-top: 6px; }
          </style>
        </head>
        <body>
          <div class="center">
            <div class="header-title bold">DONA LU PASTELARIA</div>
            <div class="bold">EXTRATO DE CONTA</div>
            <div class="divider">${dividerLine}</div>
            <div class="seq-box">${titleText}</div>
            <div class="divider">${dividerLine}</div>
          </div>
          <div>
            <div><strong>Data/Hora:</strong> ${dateStr}</div>
            <div><strong>Mesa:</strong> ${tableNum}</div>
            ${targetClientName ? `<div><strong>Cliente:</strong> ${targetClientName}</div>` : ''}
            <div class="divider">${dividerLine}</div>
          </div>
          <div class="bold" style="margin-bottom: 4px;">DISCRIMINACAO DO CONSUMO:</div>
          ${itemsHtml}
          <div class="divider">${dividerLine}</div>
          <div class="right">
            ${totalServiceFee > 0 ? `<div>Taxa de Servico (10%): R$ ${totalServiceFee.toFixed(2).replace('.', ',')}</div>` : ''}
            <div class="total-row">
              <span>TOTAL A PAGAR:</span>
              <span>R$ ${grandTotal.toFixed(2).replace('.', ',')}</span>
            </div>
          </div>
          <div class="divider">${dividerLine}</div>
          <div class="center" style="font-size: 9px; margin-top: 10px;">
            <div>Conferir consumo antes de efetuar o pagamento.</div>
            <div class="bold">Obrigado pela visita!</div>
          </div>
          <!-- Texto final repetido 5 vezes para evitar que o corte corte o texto do pedido -->
          <div style="display: block; clear: both; text-align: center; font-size: 11px; font-weight: bold; margin-top: 15px; line-height: 1.4;">
            <div>Obrigado pela visita!</div>
            <div>Obrigado pela visita!</div>
            <div>Obrigado pela visita!</div>
            <div>Obrigado pela visita!</div>
            <div>Obrigado pela visita!</div>
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
        setTimeout(() => { document.body.removeChild(iframe); }, 1000);
      }
    }, 350);
  } else {
    // Binary ESC/POS for Direct BLE / Serial
    const encoder = new TextEncoder();
    const buffer: number[] = [];

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
      const cleanText = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^ -~\n\r\t]/g, '');
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

    buffer.push(...INIT, ...ALIGN_CENTER, ...BOLD_ON);
    writeLine('DONA LU PASTELARIA');
    writeLine('EXTRATO DE CONTA');
    buffer.push(...BOLD_OFF);
    divider();

    buffer.push(...ALIGN_CENTER, ...BOLD_ON, ...DOUBLE_SIZE_ON);
    writeLine(targetClientName ? `CLIENTE: ${targetClientName.toUpperCase()}` : `MESA ${tableNum}`);
    buffer.push(...DOUBLE_SIZE_OFF, ...BOLD_OFF);
    divider();

    buffer.push(...ALIGN_LEFT);
    writeLine(`Data/Hora: ${dateStr}`);
    writeLine(`Mesa: ${tableNum}`);
    if (targetClientName) writeLine(`Cliente: ${targetClientName}`);
    divider();

    buffer.push(...BOLD_ON);
    writeLine('DISCRIMINACAO DO CONSUMO:');
    buffer.push(...BOLD_OFF);

    ordersList.forEach(order => {
      order.items.forEach(item => {
        const qtyStr = `${item.quantity}x `;
        const priceStr = `R$ ${((item.price ?? 0) * item.quantity).toFixed(2).replace('.', ',')}`;
        const maxChars = settings.paperSize === '80mm' ? 48 : 32;
        const nameLen = maxChars - qtyStr.length - priceStr.length;
        let nameStr = item.name;
        if (nameStr.length > nameLen) nameStr = nameStr.substring(0, nameLen - 3) + '...';
        const padSize = nameLen - nameStr.length;
        writeLine(`${qtyStr}${nameStr}${' '.repeat(padSize > 0 ? padSize : 0)}${priceStr}`);
      });
    });
    divider();

    buffer.push(...ALIGN_RIGHT);
    if (totalServiceFee > 0) {
      writeLine(`Taxa Servico (10%): R$ ${totalServiceFee.toFixed(2).replace('.', ',')}`);
    }
    buffer.push(...BOLD_ON);
    writeLine(`TOTAL A PAGAR: R$ ${grandTotal.toFixed(2).replace('.', ',')}`);
    buffer.push(...BOLD_OFF);

    buffer.push(...ALIGN_CENTER);
    divider();
    writeLine('Conferir consumo antes de pagar.');
    writeLine('Obrigado pela visita!');
    // Print and feed 8 lines (ESC d 8) to push the text past the tear bar / cutter
    buffer.push(0x1B, 0x64, 0x08);

    // Paper Cut Command (only for 80mm printers which usually have auto-cutters)
    if (settings.paperSize === '80mm') {
      buffer.push(0x1D, 0x56, 0x42, 0x00);
    }

    const binaryData = new Uint8Array(buffer);

    if (settings.method === 'bluetooth' && isBluetoothConnected() && activeBluetoothCharacteristic) {
      const chunkSize = 20;
      for (let i = 0; i < binaryData.length; i += chunkSize) {
        const chunk = binaryData.slice(i, i + chunkSize);
        await activeBluetoothCharacteristic.writeValue(chunk);
        await new Promise(r => setTimeout(r, 15));
      }
    } else if (settings.method === 'serial' && isSerialConnected() && activeSerialPort) {
      const writer = activeSerialPort.writable.getWriter();
      try {
        await writer.write(binaryData);
      } finally {
        writer.releaseLock();
      }
    }
  }
}

export async function printPaymentReceipt(ordersList: OrderDocument[], isTable: boolean, tableNum?: string): Promise<void> {
  const settings = getPrinterSettings();
  if (!ordersList || ordersList.length === 0) return;

  const paperWidth = settings.paperSize === '58mm' ? '56mm' : '78mm';
  const dividerLine = '-'.repeat(settings.paperSize === '80mm' ? 48 : 32);

  const grandTotal = ordersList.reduce((sum, o) => sum + o.total, 0);
  
  let latestDateStr = new Date().toLocaleString('pt-BR');
  if (ordersList.length > 0) {
    const sorted = [...ordersList].sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    latestDateStr = new Date(sorted[0].createdAt).toLocaleString('pt-BR');
  }

  const paymentMethods = ordersList.map(o => o.paymentMethod).filter(Boolean);
  let paymentMethod = paymentMethods.length > 0 ? paymentMethods[0] : 'NÃO INFORMADO';
  if (paymentMethod === 'maq_debito' || paymentMethod === 'debito') paymentMethod = 'DÉBITO';
  if (paymentMethod === 'maq_credito' || paymentMethod === 'credito') paymentMethod = 'CRÉDITO';
  if (paymentMethod === 'maq_pix' || paymentMethod === 'pix') paymentMethod = 'PIX';
  
  const mercadoPagoId = ordersList.find(o => o.mercadoPagoPaymentId)?.mercadoPagoPaymentId;

  const paymentsList = ordersList[0].payments && ordersList[0].payments.length > 0 
    ? ordersList[0].payments 
    : [{ method: paymentMethod, amount: grandTotal }];

  const formatMethod = (m: string | null | undefined) => {
    if (m === 'maq_debito' || m === 'debito') return 'DÉBITO';
    if (m === 'maq_credito' || m === 'credito') return 'CRÉDITO';
    if (m === 'maq_pix' || m === 'pix') return 'PIX';
    return m ? m.toUpperCase() : 'NÃO INFORMADO';
  };

  if (settings.method === 'browser') {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    const receiptsHtml = paymentsList.map((payment, idx) => `
      <div style="${idx > 0 ? 'page-break-before: always; margin-top: 30px;' : ''}">
        <div class="center bold" style="font-size: 14px;">DONA LU PASTELARIA</div>
        <div class="center" style="margin-top: 5px;">CNPJ: 54.499.712/0001-90</div>
        <div class="line">${dividerLine}</div>
        <div class="center bold" style="font-size: 14px; margin: 5px 0;">COMPROVANTE DE PAGAMENTO</div>
        <div class="center bold" style="margin-bottom: 5px;">VIA DO CLIENTE</div>
        <div class="line">${dividerLine}</div>
        
        <div class="left" style="margin-top: 5px;">
          ${isTable ? `<div><span class="bold">REF:</span> CONTA DA MESA ${tableNum} ${paymentsList.length > 1 ? `(Parte ${idx+1}/${paymentsList.length})` : ''}</div>` : `<div><span class="bold">REF:</span> PEDIDO #${ordersList[0].dailySeq ? String(ordersList[0].dailySeq).padStart(2, '0') : (ordersList[0].id?.substring(0,6) || 'NEW')}</div>`}
          <div><span class="bold">DATA/HORA:</span> ${latestDateStr}</div>
        </div>
        
        <div class="line">${dividerLine}</div>
        
        <div class="flex-between bold" style="font-size: 15px; margin: 10px 0;">
          <span>VALOR PAGO:</span>
          <span>R$ ${Number(payment.amount).toFixed(2).replace('.', ',')}</span>
        </div>
        
        <div class="line">${dividerLine}</div>
        
        <div class="left" style="margin-top: 10px;">
          <div><span class="bold">FORMA DE PAGTO:</span> ${formatMethod(payment.method)}</div>
          ${mercadoPagoId ? `<div><span class="bold">TRANS. MP:</span> ${mercadoPagoId}</div>` : ''}
          <div style="margin-top: 4px;"><span class="bold">STATUS:</span> TRANSAÇÃO APROVADA</div>
        </div>
        
        <div class="line" style="margin-top: 15px;">${dividerLine}</div>
        <div class="center bold" style="margin-top: 10px;">
          Obrigado pela preferência!
        </div>
        <div class="center" style="margin-bottom: 30px;">.</div>
      </div>
    `).join('');

    let html = `
      <html>
      <head>
        <style>
          @page { margin: 0; }
          body { 
            font-family: 'Courier New', Courier, monospace; 
            width: ${paperWidth}; 
            margin: 0; 
            padding: 10px 0; 
            font-size: 12px;
            color: #000;
          }
          .center { text-align: center; }
          .left { text-align: left; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .line { margin: 4px 0; text-align: center; }
          .flex-between { display: flex; justify-content: space-between; }
        </style>
      </head>
      <body>
        ${receiptsHtml}
      </body>
      </html>
    `;

    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 500);
    }, 250);
  } else {
    alert("Reimpressão de comprovante por bluetooth/serial requer o método 'browser' nas configurações.");
  }
}
