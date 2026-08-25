import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { doc, getDoc, setDoc, updateDoc, collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { User, Store, Shield, CreditCard, Save, Trash2, Clock, MapPin, AlertCircle, History, FileText, KeyRound, Plus, Camera, QrCode, Wallet, Printer, Settings, ClipboardList, X, Edit2 } from 'lucide-react';
import { logAuditAction } from '../utils/audit';
import { SecurityCameraSettings } from '../components/SecurityCameraSettings';
import { TableQrCodeGenerator } from '../components/TableQrCodeGenerator';
import { 
  getPrinterSettings, 
  savePrinterSettings, 
  connectPrinter, 
  disconnectPrinter, 
  isBluetoothConnected, 
  getConnectedDeviceName, 
  subscribeToBluetoothState, 
  printMockOrder,
  connectSerial,
  disconnectSerial,
  isSerialConnected,
  getConnectedSerialName,
  subscribeToSerialState
} from '../utils/printer';
import type { PrinterSettings } from '../utils/printer';

interface StoreConfig {
  isOpen: boolean;
  deliveryFee: number;
  stampsNeeded: number;
  openingTime: string;
  closingTime: string;
  storeAddress: string;
  phoneContact: string;
  maxIngredientsLimit?: number;
  availableIngredients?: string[];
  devPercentage?: number;
  devClientId?: string;
  devAccessToken?: string;
  storeOwnerAccessToken?: string;
  storeOwnerEmail?: string;
  storeOwnerId?: string;
  mpPublicKey?: string;
  stoneEnabled?: boolean;
  stoneAccessToken?: string;
  stonePublicKey?: string;
  stoneWebhookSecret?: string;
  stoneTerminalId?: string;
  stoneRecipientId?: string;
  pointSmart2Id?: string;
  pointSmart2PosId?: string;
  pointPro3Id?: string;
  pointPro3PosId?: string;
  pointAir2Id?: string;
  pointAir2PosId?: string;
  pointMiniNfc2Id?: string;
  pointMiniNfc2PosId?: string;
  pointSmart2Mode?: string;
  pointPro3Mode?: string;
  pointAir2Mode?: string;
  pointMiniNfc2Mode?: string;
  disabledPaymentMethods?: string[];
  paymentMethodsThemes?: Record<string, 'light' | 'dark'>;
  paymentMethodsVisibility?: Record<string, 'client' | 'staff' | 'both'>;
  paymentMethodsVisibilityByOrderType?: Record<string, Record<string, 'client' | 'staff' | 'both'>>;
  paymentMethodsDescriptions?: Record<string, string>;
  paymentMethodsNames?: Record<string, string>;
  requireCashierApproval?: boolean;
  deliveryBaseKm?: number;
  deliveryBaseFee?: number;
  deliveryAdditionalKmFee?: number;
  openDays?: (number | string)[];
  disabledPaymentMethodsByOrderType?: Record<string, string[]>;
  isTemporarilyClosed?: boolean;
  temporaryCloseReason?: string;
}

export const SettingsPage = () => {
  const { user, userData, updatePhoneNumber } = useAuth();
  
  // Tabs state: 'profile' (all) | 'store' (admin) | 'loyalty' (admin) | 'advanced' (dev) | 'audit_logs' (admin) | 'commissions' | 'security' | 'payments' | 'printer'
  const [activeTab, setActiveTab] = useState<'profile' | 'store' | 'loyalty' | 'advanced' | 'audit_logs' | 'commissions' | 'security' | 'mesas' | 'point_guide' | 'payments' | 'printer' | 'elgin_i8'>('profile');
  const [selectedOrderTypeFilter, setSelectedOrderTypeFilter] = useState<'dine_in_table' | 'dine_in' | 'pickup' | 'delivery' | 'pdv'>('delivery');

  // Printer config states
  const [printerSettings, setPrinterSettingsState] = useState<PrinterSettings>(() => getPrinterSettings());
  const [isBtConnected, setIsBtConnected] = useState(isBluetoothConnected());
  const [btDeviceName, setBtDeviceName] = useState(getConnectedDeviceName());
  const [isSerialConn, setIsSerialConn] = useState(isSerialConnected());
  const [serialDeviceName, setSerialDeviceName] = useState(getConnectedSerialName());
  const [isPairing, setIsPairing] = useState(false);
  const [isSerialPairing, setIsSerialPairing] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printSuccess, setPrintSuccess] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribeBt = subscribeToBluetoothState((connected, name) => {
      setIsBtConnected(connected);
      setBtDeviceName(name || '');
    });
    const unsubscribeSerial = subscribeToSerialState((connected, name) => {
      setIsSerialConn(connected);
      setSerialDeviceName(name || '');
    });
    return () => {
      unsubscribeBt();
      unsubscribeSerial();
    };
  }, []);

  const handleConnectBt = async () => {
    setIsPairing(true);
    setPrintError(null);
    setPrintSuccess(false);
    try {
      await connectPrinter();
      setPrintSuccess(true);
      setTimeout(() => setPrintSuccess(false), 3000);
    } catch (err: any) {
      setPrintError(err.message || 'Erro ao conectar à impressora Bluetooth.');
    } finally {
      setIsPairing(false);
    }
  };

  const handleDisconnectBt = () => {
    disconnectPrinter();
    setPrintSuccess(false);
  };

  const handleConnectSerial = async () => {
    setIsSerialPairing(true);
    setPrintError(null);
    setPrintSuccess(false);
    try {
      await connectSerial(printerSettings.baudRate);
      setPrintSuccess(true);
      setTimeout(() => setPrintSuccess(false), 3000);
    } catch (err: any) {
      setPrintError(err.message || 'Erro ao conectar à impressora USB/Serial.');
    } finally {
      setIsSerialPairing(false);
    }
  };

  const handleDisconnectSerial = () => {
    disconnectSerial();
    setPrintSuccess(false);
  };

  const handleSavePrinterSettings = (newSettings: PrinterSettings) => {
    setPrinterSettingsState(newSettings);
    savePrinterSettings(newSettings);
    showFeedback('success', 'Configurações de impressão salvas com sucesso!');
  };

  const handleTestPrint = async () => {
    setPrintError(null);
    setPrintSuccess(false);
    try {
      await printMockOrder();
      setPrintSuccess(true);
      setTimeout(() => setPrintSuccess(false), 3000);
    } catch (err: any) {
      setPrintError(err.message || 'Erro ao realizar impressão de teste.');
    }
  };
  
  const role = userData?.role || 'client';
  const isAdmin = ['developer', 'owner', 'manager'].includes(role);
  const isDev = role === 'developer';

  // Profile states
  const [profileName, setProfileName] = useState(user?.displayName || '');
  const [profilePhone, setProfilePhone] = useState(userData?.phoneNumber || '');
  const [profileCpf, setProfileCpf] = useState(userData?.cpf || '');
  
  // Address states
  const [street, setStreet] = useState(userData?.clientAddress?.street || '');
  const [number, setNumber] = useState(userData?.clientAddress?.number || '');
  const [neighborhood, setNeighborhood] = useState(userData?.clientAddress?.neighborhood || '');
  const [city, setCity] = useState(userData?.clientAddress?.city || '');
  const [zipCode, setZipCode] = useState(userData?.clientAddress?.zipCode || '');
  const [complement, setComplement] = useState(userData?.clientAddress?.complement || '');

  // Store config states
  const [storeConfig, setStoreConfig] = useState<StoreConfig>({
    isOpen: true,
    deliveryFee: 7.00,
    stampsNeeded: 10,
    openingTime: '18:00',
    closingTime: '23:30',
    storeAddress: 'Rua Jícara, 239 - Campo Grande - RJ',
    phoneContact: '(21) 3439-5241',
    deliveryBaseKm: 3.0,
    deliveryBaseFee: 5.00,
    deliveryAdditionalKmFee: 1.00,
    openDays: [0, 1, 2, 3, 4, 5, 6]
  });

  const [loadingStore, setLoadingStore] = useState(false);
  const [submittingProfile, setSubmittingProfile] = useState(false);
  const [submittingStore, setSubmittingStore] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Point device management states
  interface PointDevice {
    id: string;
    external_id: string;
    operating_mode: 'PDV' | 'STANDALONE';
    model: string;
    serial_number: string;
    store_id: string;
    pos_id: string;
    external_store_id: string;
    external_pos_id: string;
  }
  const [pointDevices, setPointDevices] = useState<PointDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceModelMap, setDeviceModelMap] = useState<Record<string, string>>({});
  // Map: deviceId -> selected pos external_id
  const [devicePosMap, setDevicePosMap] = useState<Record<string, string>>({});
  const [settingMode, setSettingMode] = useState<Record<string, boolean>>({});
  const [savingDeviceSelection, setSavingDeviceSelection] = useState(false);

  interface MPStore {
    id: string | number;
    name: string;
  }
  interface MPPos {
    id: number;
    name: string;
    store_id: number;
    external_id: string;
  }
  const [mpStores, setMpStores] = useState<MPStore[]>([]);
  const [mpPosList, setMpPosList] = useState<MPPos[]>([]);
  const [mpUserId, setMpUserId] = useState<string>('');
  const [creatingStorePos, setCreatingStorePos] = useState(false);

  // Stone Onboarding States
  const [stoneName, setStoneName] = useState("");
  const [stoneEmail, setStoneEmail] = useState("");
  const [stoneDocument, setStoneDocument] = useState("");
  const [stoneBank, setStoneBank] = useState("");
  const [stoneBranch, setStoneBranch] = useState("");
  const [stoneBranchDigit, setStoneBranchDigit] = useState("");
  const [stoneAccount, setStoneAccount] = useState("");
  const [stoneAccountDigit, setStoneAccountDigit] = useState("");
  const [stoneAccountType, setStoneAccountType] = useState<"checking" | "savings">("checking");
  const [creatingStoneRecipient, setCreatingStoneRecipient] = useState(false);

  const handleFetchDevices = async () => {
    const token = storeConfig?.storeOwnerAccessToken;
    if (!token) {
      setDeviceError('Configure primeiro o Access Token do estabelecimento na aba "Avançado".');
      return;
    }
    setLoadingDevices(true);
    setDeviceError(null);
    setPointDevices([]);
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${API_BASE_URL}/api/point/devices?token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Erro ao buscar dispositivos.');
      }
      setPointDevices(data.devices || []);
      if ((data.devices || []).length === 0) {
        setDeviceError('Nenhuma maquininha encontrada nesta conta. Verifique se as maquininhas estão cadastradas no painel do Mercado Pago.');
      }
      // Fetch User ID
      let fetchedUserId = '';
      try {
        const uRes = await fetch(`${API_BASE_URL}/api/point/user?token=${encodeURIComponent(token)}`);
        const uData = await uRes.json();
        if (uData.success && uData.user && uData.user.id) {
          fetchedUserId = String(uData.user.id);
          setMpUserId(fetchedUserId);
        }
      } catch(e) { console.error('Erro user:', e); }

      // Fetch Stores
      if (fetchedUserId) {
        try {
          const sRes = await fetch(`${API_BASE_URL}/api/point/stores?token=${encodeURIComponent(token)}&user_id=${fetchedUserId}`);
          const sData = await sRes.json();
          if (sData.success) {
            setMpStores(sData.stores || []);
          }
        } catch(e) { console.error('Erro stores:', e); }
      }

      // Fetch POS
      try {
        const pRes = await fetch(`${API_BASE_URL}/api/point/pos?token=${encodeURIComponent(token)}`);
        const pData = await pRes.json();
        if (pData.success) {
          setMpPosList(pData.pos || []);
        }
      } catch(e) { console.error('Erro pos:', e); }

      // Pre-fill deviceModelMap and devicePosMap based on existing configs
      const existingMap: Record<string, string> = {};
      const existingPosMap: Record<string, string> = {};
      const modelFields: { id: string, slot: string, posId: string }[] = [
        { id: storeConfig?.pointSmart2Id || '', slot: 'smart2', posId: storeConfig?.pointSmart2PosId || '' },
        { id: storeConfig?.pointPro3Id || '', slot: 'pro3', posId: storeConfig?.pointPro3PosId || '' },
        { id: storeConfig?.pointAir2Id || '', slot: 'air2', posId: storeConfig?.pointAir2PosId || '' },
        { id: storeConfig?.pointMiniNfc2Id || '', slot: 'mininfc2', posId: storeConfig?.pointMiniNfc2PosId || '' },
      ];
      for (const { id, slot, posId } of modelFields) {
        if (id) {
          const matched = (data.devices || []).find((d: PointDevice) => d.id === id || d.external_id === id || d.pos_id === id);
          if (matched) {
            existingMap[matched.id] = slot;
            if (posId) existingPosMap[matched.id] = posId;
          }
        }
      }
      setDeviceModelMap(existingMap);
      setDevicePosMap(existingPosMap);
    } catch (err: any) {
      setDeviceError(err.message || 'Erro ao buscar maquininhas.');
    } finally {
      setLoadingDevices(false);
    }
  };

  const handleCreateStore = async () => {
    const token = storeConfig?.storeOwnerAccessToken;
    if (!token || !mpUserId) return;
    setCreatingStorePos(true);
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${API_BASE_URL}/api/point/stores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, user_id: mpUserId, name: 'Dona Lu Pastelaria (Matriz)' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showFeedback('success', 'Loja matriz criada com sucesso!');
        handleFetchDevices(); // re-fetch
      } else {
        throw new Error(data.message || 'Erro ao criar loja');
      }
    } catch(err: any) {
      showFeedback('error', `Erro: ${err.message}`);
    } finally {
      setCreatingStorePos(false);
    }
  };

  const handleCreatePos = async () => {
    const token = storeConfig?.storeOwnerAccessToken;
    if (!token || mpStores.length === 0) return;
    setCreatingStorePos(true);
    try {
      const storeId = mpStores[0].id;
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${API_BASE_URL}/api/point/pos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          token, 
          name: `Caixa PDV ${mpPosList.length + 1}`, 
          store_id: storeId, 
          external_store_id: `LOJA_${storeId}`, 
          external_id: `CAIXA_${Date.now()}` 
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showFeedback('success', 'Caixa criado com sucesso!');
        handleFetchDevices(); // re-fetch
      } else {
        throw new Error(data.message || 'Erro ao criar caixa');
      }
    } catch(err: any) {
      showFeedback('error', `Erro: ${err.message}`);
    } finally {
      setCreatingStorePos(false);
    }
  };

  const handleCreateStoneRecipient = async () => {
    const token = storeConfig?.stoneAccessToken;
    if (!token) {
      showFeedback('error', 'Preencha a Secret Key da Stone e salve antes de conectar a conta bancária.');
      return;
    }
    setCreatingStoneRecipient(true);
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://localhost:5173';
      const cleanDoc = stoneDocument.replace(/\D/g, '');
      const type = cleanDoc.length > 11 ? 'company' : 'individual';
      
      const payload = {
        token: token,
        name: stoneName,
        email: stoneEmail,
        document: cleanDoc,
        type: type,
        bank: stoneBank,
        branch_number: stoneBranch,
        branch_check_digit: stoneBranchDigit || '0',
        account_number: stoneAccount,
        account_check_digit: stoneAccountDigit || '0',
        account_type: stoneAccountType
      };

      const res = await fetch(`${API_BASE_URL}/api/pagamentos/stone-create-recipient`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const docRef = doc(db, 'settings', 'store_config');
        await updateDoc(docRef, { stoneRecipientId: data.recipientId });
        setStoreConfig(prev => ({ ...prev, stoneRecipientId: data.recipientId }));
        showFeedback('success', 'Recebedor da Stone criado com sucesso! O Split automático está ativo.');
      } else {
        throw new Error(data.message || 'Erro ao criar recebedor');
      }
    } catch(err: any) {
      showFeedback('error', `Erro: ${err.message}`);
    } finally {
      setCreatingStoneRecipient(false);
    }
  };

  const handleSetDeviceMode = async (deviceId: string, mode: 'PDV' | 'STANDALONE') => {
    const token = storeConfig?.storeOwnerAccessToken;
    if (!token) return;
    setSettingMode(prev => ({ ...prev, [deviceId]: true }));
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${API_BASE_URL}/api/point/set-mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, deviceId, mode })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Erro ao alterar modo.');
      }
      // Update local state
      setPointDevices(prev => prev.map(d => d.id === deviceId ? { ...d, operating_mode: mode } : d));
      
      const assignedSlot = deviceModelMap[deviceId];
      const slotMap: Record<string, string> = { smart2: 'pointSmart2Mode', pro3: 'pointPro3Mode', air2: 'pointAir2Mode', mininfc2: 'pointMiniNfc2Mode' };
      if (assignedSlot && slotMap[assignedSlot]) {
        const docRef = doc(db, 'settings', 'store_config');
        updateDoc(docRef, { [slotMap[assignedSlot]]: mode }).catch(e => console.error("Error updating mode in store_config:", e));
        setStoreConfig(prev => prev ? ({ ...prev, [slotMap[assignedSlot]]: mode }) : prev);
      }
      
      showFeedback('success', `✅ ${data.message}`);
    } catch (err: any) {
      showFeedback('error', `❌ ${err.message}`);
    } finally {
      setSettingMode(prev => ({ ...prev, [deviceId]: false }));
    }
  };

  const handleSaveDeviceSelection = async () => {
    if (!user || !isAdmin) return;
    setSavingDeviceSelection(true);
    try {
      const slotToId: Record<string, string> = { smart2: '', pro3: '', air2: '', mininfc2: '' };
      const slotToMode: Record<string, string> = { smart2: '', pro3: '', air2: '', mininfc2: '' };
      const slotToPos: Record<string, string> = { smart2: '', pro3: '', air2: '', mininfc2: '' };
      for (const [devId, slot] of Object.entries(deviceModelMap)) {
        if (slot && slotToId[slot] !== undefined) {
          const device = pointDevices.find(d => d.id === devId);
          slotToId[slot] = device?.id || device?.external_id || devId;
          slotToMode[slot] = device?.operating_mode || 'PDV';
          slotToPos[slot] = devicePosMap[devId] || '';
        }
      }
      const docRef = doc(db, 'settings', 'store_config');
      await updateDoc(docRef, {
        pointSmart2Id: slotToId.smart2,
        pointSmart2Mode: slotToMode.smart2,
        pointSmart2PosId: slotToPos.smart2,
        pointPro3Id: slotToId.pro3,
        pointPro3Mode: slotToMode.pro3,
        pointPro3PosId: slotToPos.pro3,
        pointAir2Id: slotToId.air2,
        pointAir2Mode: slotToMode.air2,
        pointAir2PosId: slotToPos.air2,
        pointMiniNfc2Id: slotToId.mininfc2,
        pointMiniNfc2Mode: slotToMode.mininfc2,
        pointMiniNfc2PosId: slotToPos.mininfc2
      });
      setStoreConfig(prev => prev ? ({
        ...prev,
        pointSmart2Id: slotToId.smart2,
        pointSmart2Mode: slotToMode.smart2,
        pointSmart2PosId: slotToPos.smart2,
        pointPro3Id: slotToId.pro3,
        pointPro3Mode: slotToMode.pro3,
        pointPro3PosId: slotToPos.pro3,
        pointAir2Id: slotToId.air2,
        pointAir2Mode: slotToMode.air2,
        pointAir2PosId: slotToPos.air2,
        pointMiniNfc2Id: slotToId.mininfc2,
        pointMiniNfc2Mode: slotToMode.mininfc2,
        pointMiniNfc2PosId: slotToPos.mininfc2
      }) : prev);
      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || 'Administrador',
        actionType: 'UPDATE_POINT_DEVICES',
        title: 'Maquininhas Point Configuradas',
        description: `IDs das maquininhas atualizados — Smart2: "${slotToId.smart2}", Pro3: "${slotToId.pro3}", Air2: "${slotToId.air2}", MiniNFC2: "${slotToId.mininfc2}"`
      });
      showFeedback('success', '✅ IDs das maquininhas salvos com sucesso!');
    } catch (err) {
      showFeedback('error', 'Erro ao salvar configuração das maquininhas.');
    } finally {
      setSavingDeviceSelection(false);
    }
  };

  // Sync profile details when userData updates
  useEffect(() => {
    if (userData) {
      setProfilePhone(userData.phoneNumber || '');
      setProfileCpf(userData.cpf || '');
      if (userData.clientAddress) {
        setStreet(userData.clientAddress.street || '');
        setNumber(userData.clientAddress.number || '');
        setNeighborhood(userData.clientAddress.neighborhood || '');
        setCity(userData.clientAddress.city || '');
        setZipCode(userData.clientAddress.zipCode || '');
        setComplement(userData.clientAddress.complement || '');
      }
    }
  }, [userData]);

  useEffect(() => {
    if (user?.displayName) {
      setProfileName(user.displayName);
    }
  }, [user]);

  // Load global store configurations from firestore
  useEffect(() => {
    if (!isAdmin) return;
    
    const loadStoreConfig = async () => {
      setLoadingStore(true);
      try {
        const docRef = doc(db, 'settings', 'store_config');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setStoreConfig(docSnap.data() as StoreConfig);
        } else {
          // Initialize defaults in database
          const defaults: StoreConfig = {
            isOpen: true,
            deliveryFee: 7.00,
            stampsNeeded: 10,
            openingTime: '18:00',
            closingTime: '23:30',
            storeAddress: 'Rua Jícara, 239 - Campo Grande - RJ',
            phoneContact: '(21) 3439-5241',
            deliveryBaseKm: 3.0,
            deliveryBaseFee: 5.00,
            deliveryAdditionalKmFee: 1.00,
            openDays: [0, 1, 2, 3, 4, 5, 6],
            devPercentage: 1,
            devClientId: '',
            devAccessToken: '',
            storeOwnerAccessToken: '',
            storeOwnerEmail: '',
            pointSmart2Id: '',
            pointPro3Id: '',
            pointAir2Id: '',
            pointMiniNfc2Id: '',
            maxIngredientsLimit: 5,
            availableIngredients: ['Palmito', 'Alho poró', 'Tomate', 'Cebola', 'Alho torrado', 'Ovo', 'Azeitona verde', 'Azeitona Preta', 'Milho', 'Ervilha', 'Orégano', 'Calabresa', 'Bacon'],
            paymentMethodsThemes: {
              pix: 'dark',
              credito: 'dark',
              google_pay: 'dark',
              debito_point: 'dark',
              credito_point: 'dark',
              dinheiro: 'dark',
              pagar_final: 'dark'
            },
            requireCashierApproval: true,
            isTemporarilyClosed: false,
            temporaryCloseReason: ''
          };
          await setDoc(docRef, defaults);
          setStoreConfig(defaults);
        }
      } catch (err) {
        console.error('Erro ao buscar configurações da loja:', err);
      } finally {
        setLoadingStore(false);
      }
    };

    loadStoreConfig();
  }, [isAdmin]);

  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Load audit logs from firestore
  useEffect(() => {
    if (activeTab !== 'audit_logs' || !isAdmin) return;
    
    setLoadingLogs(true);
    const q = query(
      collection(db, 'audit_logs'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: any[] = [];
      snapshot.forEach((docSnap) => {
        fetched.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });
      setAuditLogs(fetched);
      setLoadingLogs(false);
    }, (err) => {
      console.error('Erro ao buscar logs de auditoria:', err);
      setLoadingLogs(false);
    });

    return () => unsubscribe();
  }, [activeTab, isAdmin]);

  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [billDinheiro, setBillDinheiro] = useState(true);
  const [billPix, setBillPix] = useState(true);
  const [billDebito, setBillDebito] = useState(true);
  const [billCredito, setBillCredito] = useState(false);

  // Load orders for commissions calculation
  useEffect(() => {
    if (activeTab !== 'commissions' || !isAdmin) return;
    
    setLoadingOrders(true);
    const q = query(
      collection(db, 'orders'),
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: any[] = [];
      snapshot.forEach((docSnap) => {
        fetched.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });
      setOrders(fetched);
      setLoadingOrders(false);
    }, (err) => {
      console.error('Erro ao buscar pedidos:', err);
      setLoadingOrders(false);
    });

    return () => unsubscribe();
  }, [activeTab, isAdmin]);

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const [exchangingOAuth, setExchangingOAuth] = useState(false);

  // Process the MP OAuth code that was stored by App.tsx after the redirect
  useEffect(() => {
    const pendingCode = sessionStorage.getItem('mp_oauth_pending_code');
    if (!pendingCode || !isAdmin || !storeConfig) return;

    // Guard: if devClientId is not loaded yet, bail — the effect will re-run when it loads
    const clientId = storeConfig.devClientId || '';
    if (!clientId) {
      console.warn('[MP OAuth] devClientId ainda não carregado, aguardando...');
      return;
    }

    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
    const doExchange = async () => {
      setExchangingOAuth(true);
      // Only remove the code AFTER confirming we have all required params
      sessionStorage.removeItem('mp_oauth_pending_code');
      try {
        const response = await fetch(`${API_BASE_URL}/api/mercadopago/exchange-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: pendingCode,
            clientId,
            redirectUri: window.location.origin + '/'
          })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Falha ao trocar código OAuth.');
        }
        // Save the real access_token to Firestore immediately
        const docRef = doc(db, 'settings', 'store_config');
        await updateDoc(docRef, {
          storeOwnerAccessToken: result.accessToken,
          storeOwnerEmail: result.email || storeConfig.storeOwnerEmail || ''
        });
        setStoreConfig((prev: any) => ({
          ...prev,
          storeOwnerAccessToken: result.accessToken,
          storeOwnerEmail: result.email || prev?.storeOwnerEmail || ''
        }));
        showFeedback('success', `✅ Conta do estabelecimento (${result.email || result.nickname || 'ID ' + result.userId}) conectada com sucesso via Mercado Pago!`);
      } catch (err: any) {
        console.error('[MP OAuth] Erro na troca de código:', err);
        // Restore the code so user can retry without going through OAuth again
        sessionStorage.setItem('mp_oauth_pending_code', pendingCode);
        showFeedback('error', `❌ Erro ao conectar conta MP: ${err.message}`);
      } finally {
        setExchangingOAuth(false);
      }
    };
    doExchange();
  }, [isAdmin, storeConfig?.devClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [submittingDevMP, setSubmittingDevMP] = useState(false);

  const handleSaveDevMPConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!isDev && role !== 'owner') || !user) return;
    setSubmittingDevMP(true);

    try {
      const docRef = doc(db, 'settings', 'store_config');
      
      const updateData: any = {
        storeOwnerAccessToken: storeConfig.storeOwnerAccessToken ?? '',
        storeOwnerEmail: storeConfig.storeOwnerEmail ?? ''
      };

      if (isDev || role === 'owner') {
        updateData.devPercentage = storeConfig.devPercentage ?? 1;
        updateData.devClientId = storeConfig.devClientId ?? '';
        updateData.devAccessToken = storeConfig.devAccessToken ?? '';
        updateData.mpPublicKey = storeConfig.mpPublicKey ?? '';
        updateData.stoneEnabled = storeConfig.stoneEnabled ?? false;
        updateData.stoneAccessToken = storeConfig.stoneAccessToken ?? '';
        updateData.stonePublicKey = storeConfig.stonePublicKey ?? '';
        updateData.stoneWebhookSecret = storeConfig.stoneWebhookSecret ?? '';
        updateData.stoneTerminalId = storeConfig.stoneTerminalId ?? '';
      }

      await updateDoc(docRef, updateData);

      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || (isDev ? 'Developer' : 'Proprietário'),
        actionType: 'UPDATE_DEV_MP_CONFIG',
        title: 'Configuração do Mercado Pago Split',
        description: isDev 
          ? `O desenvolvedor atualizou as configurações de Split do Mercado Pago. Porcentagem Dev: ${storeConfig.devPercentage}%, Porcentagem Estabelecimento: ${100 - (storeConfig.devPercentage ?? 1)}%`
          : `O proprietário conectou/desconectou a conta do estabelecimento no Mercado Pago: ${storeConfig.storeOwnerEmail || 'Sem conta conectada'}`
      });

      showFeedback('success', 'Configurações do Mercado Pago salvas com sucesso!');
    } catch (err) {
      console.error(err);
      showFeedback('error', 'Erro ao salvar configurações do Mercado Pago.');
    } finally {
      setSubmittingDevMP(false);
    }
  };

  const [submittingPayments, setSubmittingPayments] = useState(false);

  const handleSavePaymentsConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !user) return;
    setSubmittingPayments(true);

    try {
      const docRef = doc(db, 'settings', 'store_config');
      console.log("Salvando formas de pagamento desativadas no Firestore:", storeConfig.disabledPaymentMethods || []);
      await updateDoc(docRef, {
        disabledPaymentMethods: storeConfig.disabledPaymentMethods || [],
        disabledPaymentMethodsByOrderType: storeConfig.disabledPaymentMethodsByOrderType || {},
        paymentMethodsThemes: storeConfig.paymentMethodsThemes || {},
        paymentMethodsVisibility: storeConfig.paymentMethodsVisibility || {},
        paymentMethodsVisibilityByOrderType: storeConfig.paymentMethodsVisibilityByOrderType || {},
        paymentMethodsDescriptions: storeConfig.paymentMethodsDescriptions || {},
        paymentMethodsNames: storeConfig.paymentMethodsNames || {},
        requireCashierApproval: storeConfig.requireCashierApproval !== undefined ? storeConfig.requireCashierApproval : false
      });

      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || 'Administrador',
        actionType: 'UPDATE_PAYMENTS_CONFIG',
        title: 'Formas de Pagamento Atualizadas',
        description: `O administrador atualizou as formas de pagamento desativadas: ${(storeConfig.disabledPaymentMethods || []).join(', ') || 'Nenhuma (todas ativas)'}.`
      });

      showFeedback('success', 'Formas de pagamento atualizadas com sucesso!');
    } catch (err) {
      console.error(err);
      showFeedback('error', 'Erro ao salvar formas de pagamento.');
    } finally {
      setSubmittingPayments(false);
    }
  };

  const handleLoginEstablishment = () => {
    const devClientId = storeConfig.devClientId || '';
    if (!devClientId) {
      showFeedback('error', 'Configure o Client ID da aplicação Mercado Pago (campo "Client ID") antes de conectar.');
      return;
    }
    const redirectUri = encodeURIComponent(window.location.origin + '/');
    const oauthUrl = `https://auth.mercadopago.com/authorization?client_id=${devClientId}&response_type=code&platform_id=mp&redirect_uri=${redirectUri}`;
    
    // Opens the MP authorization page. After the user authorizes, MP redirects
    // back to this app with ?code=..., which App.tsx detects and stores in sessionStorage.
    // Then this page's useEffect picks it up and exchanges for a real access_token.
    window.location.href = oauthUrl;
  };

  // Save profile & address configurations
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmittingProfile(true);

    try {
      // 1. Update phone if hook is available
      if (updatePhoneNumber && profilePhone !== userData?.phoneNumber) {
        await updatePhoneNumber(profilePhone);
      }

      // 2. Update address & CPF in Firestore user document
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        cpf: profileCpf.replace(/\D/g, ''),
        clientAddress: {
          street,
          number,
          neighborhood,
          city,
          zipCode: zipCode.replace(/\D/g, ''),
          complement
        },
        updatedAt: new Date().toISOString()
      });

      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || 'Usuário',
        actionType: 'UPDATE_PROFILE',
        title: 'Atualização de Perfil',
        description: `O usuário atualizou suas informações pessoais e endereço de entrega.`
      });

      showFeedback('success', 'Perfil e endereço atualizados com sucesso!');
    } catch (err: any) {
      console.error(err);
      showFeedback('error', 'Erro ao salvar alterações no perfil.');
    } finally {
      setSubmittingProfile(false);
    }
  };

  // Toggle store open/closed status and save immediately
  const handleToggleStoreOpen = async () => {
    if (!isAdmin || !user || !storeConfig) return;
    const newIsOpen = !storeConfig.isOpen;
    
    // 1. Atualiza o estado local imediatamente
    setStoreConfig(prev => prev ? { ...prev, isOpen: newIsOpen } : prev);

    try {
      // 2. Grava no Firestore imediatamente
      const docRef = doc(db, 'settings', 'store_config');
      await updateDoc(docRef, { isOpen: newIsOpen });

      // 3. Loga na auditoria
      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || 'Administrador',
        actionType: 'UPDATE_STORE_CONFIG',
        title: 'Funcionamento (Atalho)',
        description: `O administrador alterou o status da loja diretamente para: ${newIsOpen ? 'Aberta' : 'Fechada'}.`
      });

      showFeedback('success', `Loja ${newIsOpen ? 'aberta' : 'fechada'} com sucesso!`);
    } catch (err) {
      console.error(err);
      // Reverte o estado local em caso de erro
      setStoreConfig(prev => prev ? { ...prev, isOpen: !newIsOpen } : prev);
      showFeedback('error', 'Erro ao alterar status da loja no servidor.');
    }
  };

  // Save store configurations
  const handleSaveStoreConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !user) return;
    setSubmittingStore(true);

    try {
      const docRef = doc(db, 'settings', 'store_config');
      await setDoc(docRef, storeConfig);
      
      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || 'Administrador',
        actionType: 'UPDATE_STORE_CONFIG',
        title: 'Configurações de Funcionamento',
        description: `O administrador atualizou as configurações de funcionamento da loja (Status: ${storeConfig.isOpen ? 'Aberta' : 'Fechada'}, Taxa de entrega: R$ ${storeConfig.deliveryFee.toFixed(2)}, Carimbos fidelidade: ${storeConfig.stampsNeeded}).`
      });

      showFeedback('success', 'Configurações de funcionamento salvas com sucesso!');
    } catch (err) {
      console.error(err);
      showFeedback('error', 'Erro ao salvar configurações de funcionamento.');
    } finally {
      setSubmittingStore(false);
    }
  };

  // Remove saved PagBank payment card from user account
  const handleRemoveCard = async () => {
    if (!user) return;
    if (!confirm('Deseja realmente remover o cartão de crédito salvo da sua conta? Você terá que digitá-lo novamente no próximo pagamento.')) return;

    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, {
        pagbank_card_token: null,
        pagbank_card_brand: null,
        pagbank_card_last_digits: null,
        pagbank_customer_id: null,
        updatedAt: new Date().toISOString()
      });

      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || user.displayName || 'Usuário',
        actionType: 'REMOVE_PAYMENT_CARD',
        title: 'Remoção de Cartão Salvo',
        description: `O usuário removeu seu cartão de crédito salvo para pagamentos recorrentes.`
      });

      showFeedback('success', 'Cartão de crédito salvo removido com sucesso!');
    } catch (err) {
      console.error('Erro ao remover cartão de crédito:', err);
      showFeedback('error', 'Erro ao remover cartão de crédito salvo.');
    }
  };

  const formatPhone = (val: string) => {
    const digits = val.replace(/\D/g, '');
    if (digits.length <= 10) {
      return digits.replace(/^(\d{2})(\d{4})(\d{0,4})$/, (_, p1, p2, p3) => `(${p1}) ${p2}${p3 ? '-' + p3 : ''}`);
    } else {
      return digits.slice(0, 11).replace(/^(\d{2})(\d{5})(\d{0,4})$/, (_, p1, p2, p3) => `(${p1}) ${p2}${p3 ? '-' + p3 : ''}`);
    }
  };

  const formatCpf = (val: string) => {
    const digits = val.replace(/\D/g, '');
    return digits.substring(0, 11).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  };

  const getBadgeBackground = (actionType: string) => {
    switch (actionType) {
      case 'DELETE_USER':
        return 'rgba(239, 68, 68, 0.15)';
      case 'CREATE_USER':
        return 'rgba(16, 185, 129, 0.15)';
      case 'UPDATE_USER':
      case 'UPDATE_STORE_CONFIG':
        return 'rgba(245, 158, 11, 0.15)';
      case 'RESET_PASSWORD':
        return 'rgba(59, 130, 246, 0.15)';
      default:
        return 'rgba(255, 255, 255, 0.05)';
    }
  };

  const getIconComponent = (actionType: string) => {
    const size = 12;
    switch (actionType) {
      case 'DELETE_USER':
        return <Trash2 size={size} style={{ color: '#ef4444' }} />;
      case 'CREATE_USER':
        return <Plus size={size} style={{ color: '#10b981' }} />;
      case 'UPDATE_USER':
      case 'UPDATE_STORE_CONFIG':
        return <FileText size={size} style={{ color: '#f59e0b' }} />;
      case 'RESET_PASSWORD':
        return <KeyRound size={size} style={{ color: '#3b82f6' }} />;
      default:
        return <AlertCircle size={size} style={{ color: '#a3a3a3' }} />;
    }
  };

  const getWeeklyPeriod = () => {
    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
    
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - distanceToMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    
    return { start: startOfWeek, end: endOfWeek };
  };

  const getMonthlyPeriod = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();
    
    let start: Date;
    let end: Date;
    
    if (currentDay >= 10) {
      start = new Date(currentYear, currentMonth, 10, 0, 0, 0, 0);
      end = new Date(currentYear, currentMonth + 1, 9, 23, 59, 59, 999);
    } else {
      start = new Date(currentYear, currentMonth - 1, 10, 0, 0, 0, 0);
      end = new Date(currentYear, currentMonth, 9, 23, 59, 59, 999);
    }
    
    return { start, end };
  };

  const filterOfflineOrders = (periodStart: Date, periodEnd: Date) => {
    return orders.filter(order => {
      if (order.status !== 'completed') return false;
      
      const orderDate = new Date(order.createdAt);
      if (orderDate < periodStart || orderDate > periodEnd) return false;
      
      const method = order.paymentMethod;
      if (method === 'dinheiro' && billDinheiro) return true;
      if (method === 'pix' && billPix) return true;
      if (method === 'debito' && billDebito) return true;
      if (method === 'credito' && billCredito) return true;
      
      return false;
    });
  };

  return (
    <div className="dashboard-layout animate-fade-in" style={{ paddingBottom: '3rem' }}>
      <div className="dashboard-header">
        <h2>Configurações do Sistema ⚙️</h2>
        <p>Gerencie seus dados de perfil, endereços de entrega e configurações operacionais da pastelaria.</p>
      </div>

      {message && (
        <div 
          className={message.type === 'success' ? 'alert-box animate-fade-in' : 'auth-error-message animate-fade-in'}
          style={{
            marginBottom: '1.5rem',
            background: message.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            borderLeft: message.type === 'success' ? '4px solid #10b981' : '4px solid #ef4444',
            color: message.type === 'success' ? '#34d399' : '#f87171',
            padding: '1rem',
            borderRadius: '8px',
            fontSize: '0.9rem'
          }}
        >
          {message.text}
        </div>
      )}

      <div className="settings-grid">
        
        {/* Sidebar de Configurações */}
        <aside className="settings-sidebar">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.85rem 1rem',
              borderRadius: '12px',
              border: activeTab === 'profile' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
              background: activeTab === 'profile' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
              color: activeTab === 'profile' ? 'var(--primary-gold)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.9rem',
              transition: 'all 0.2s',
              textAlign: 'left'
            }}
          >
            <User size={16} />
            <span>Meu Perfil</span>
          </button>

          {(isAdmin || role === 'staff') && (
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
          )}

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
          )}

          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('store')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: activeTab === 'store' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                  background: activeTab === 'store' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                  color: activeTab === 'store' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  transition: 'all 0.2s',
                  textAlign: 'left'
                }}
              >
                <Store size={16} />
                <span>Funcionamento</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('loyalty')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: activeTab === 'loyalty' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                  background: activeTab === 'loyalty' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                  color: activeTab === 'loyalty' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  transition: 'all 0.2s',
                  textAlign: 'left'
                }}
              >
                <Shield size={16} />
                <span>Regras & Fidelidade</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('mesas')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: activeTab === 'mesas' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                  background: activeTab === 'mesas' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                  color: activeTab === 'mesas' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  transition: 'all 0.2s',
                  textAlign: 'left'
                }}
              >
                <QrCode size={16} />
                <span>Mesas & QR Codes</span>
              </button>
            </>
          )}

          {(isDev || role === 'owner') && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('security')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: activeTab === 'security' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                  background: activeTab === 'security' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                  color: activeTab === 'security' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  transition: 'all 0.2s',
                  textAlign: 'left'
                }}
              >
                <Camera size={16} style={{ color: '#10b981' }} />
                <span>Segurança</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('advanced')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  borderRadius: '12px',
                  border: activeTab === 'advanced' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                  background: activeTab === 'advanced' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                  color: activeTab === 'advanced' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  transition: 'all 0.2s',
                  textAlign: 'left'
                }}
              >
                <Shield size={16} style={{ color: '#a855f7' }} />
                <span>Avançado (Dev)</span>
              </button>
            </>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('audit_logs')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: activeTab === 'audit_logs' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                background: activeTab === 'audit_logs' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                color: activeTab === 'audit_logs' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textAlign: 'left'
              }}
            >
              <History size={16} style={{ color: '#38bdf8' }} />
              <span>Logs de Auditoria</span>
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('commissions')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: activeTab === 'commissions' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                background: activeTab === 'commissions' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                color: activeTab === 'commissions' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textAlign: 'left'
              }}
            >
              <CreditCard size={16} style={{ color: '#10b981' }} />
              <span>Fechamento de Comissão</span>
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('point_guide')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: activeTab === 'point_guide' ? '1px solid #3b82f6' : '1px solid rgba(255,255,255,0.05)',
                background: activeTab === 'point_guide' ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.02)',
                color: activeTab === 'point_guide' ? '#60a5fa' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textAlign: 'left'
              }}
            >
              <CreditCard size={16} style={{ color: '#3b82f6' }} />
              <span>📟 Guia Maquininha</span>
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('payments')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderRadius: '12px',
                border: activeTab === 'payments' ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                background: activeTab === 'payments' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                color: activeTab === 'payments' ? 'var(--primary-gold)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.9rem',
                transition: 'all 0.2s',
                textAlign: 'left'
              }}
            >
              <Wallet size={16} style={{ color: '#f59e0b' }} />
              <span>Formas de Pagamento</span>
            </button>
          )}
        </aside>

        {/* Formulários de Configurações */}
        <main className="loyalty-card" style={{ padding: '2rem', textAlign: 'left' }}>
          
          {/* Aba Mesas & QR Codes */}
          {activeTab === 'mesas' && isAdmin && (
            <TableQrCodeGenerator />
          )}

          {/* Aba Formas de Pagamento */}
          {activeTab === 'payments' && isAdmin && (
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <Wallet size={20} style={{ color: 'var(--primary-gold)' }} />
                <h3 style={{ fontSize: '1.25rem', margin: 0, fontWeight: 700 }}>Gerenciar Formas de Pagamento</h3>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.4' }}>
                Ative ou desative as formas de pagamento disponíveis para os clientes no cardápio digital, checkout e no fechamento de conta. Métodos desativados serão ocultados das opções de escolha do cliente.
              </p>

              {/* Seletor de Opção de Retirada */}
              <div style={{ marginBottom: '1.5rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>
                  Configurar Formas de Pagamento para a Opção:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', background: 'rgba(255,255,255,0.02)', padding: '0.4rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  {[
                    { id: 'pdv', label: 'PDV (Presencial) 🏪' },
                    { id: 'dine_in_table', label: 'Comer na Mesa 🍽️' },
                    { id: 'dine_in', label: 'Comer aí (Preparar) 🏢' },
                    { id: 'pickup', label: 'Retirar na Loja 🛍️' },
                    { id: 'delivery', label: 'Entrega em Casa 🛵' }
                  ].map((tab) => {
                    const isTabSelected = selectedOrderTypeFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSelectedOrderTypeFilter(tab.id as any)}
                        style={{
                          background: isTabSelected ? 'var(--primary-gold)' : 'transparent',
                          color: isTabSelected ? '#0b0f19' : 'var(--text-secondary)',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '0.5rem 1rem',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <form onSubmit={handleSavePaymentsConfig}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
                   {[
                    { id: 'pix', name: 'Pix', desc: 'Pagamento instantâneo via QR Code gerado no Mercado Pago.', label: 'Pix 🟡' },
                    { id: 'credito_mp', name: 'Crédito / Débito MP', desc: 'Pagamento via cartão de crédito ou débito online no checkout.', label: 'Crédito / Débito MP 💳' },
                    { id: 'google_pay', name: 'Google Pay', desc: 'Carteira digital rápida integrada.', label: 'Google Pay 📱' },
                    { id: 'debito_point', name: 'Débito Maquininha', desc: 'Débito presencial via maquininha Point.', label: 'Débito Maquininha 💴' },
                    { id: 'credito_point', name: 'Crédito Maquininha', desc: 'Crédito presencial via maquininha Point.', label: 'Crédito Maquininha 💳' },
                    { id: 'pix_point', name: 'Pix Maquininha', desc: 'Pagamento via Pix direto na maquininha Point (QR Code na tela da máquina).', label: 'Pix Maquininha 🟢' },
                    { id: 'pix_stone', name: 'Pix Stone', desc: 'Pagamento via Pix Stone (Mock).', label: 'Pix Stone 🟢' },
                    { id: 'credito_stone', name: 'Crédito / Débito Stone', desc: 'Cartão online via Stone (Mock).', label: 'Crédito / Débito Stone 💳' },
                    { id: 'pos_stone', name: 'Maquininha Stone', desc: 'Comunicação direta com o terminal Stone (Mock).', label: 'Maquininha Stone 💴' },
                    { id: 'dinheiro', name: 'Dinheiro', desc: 'Pagamento em dinheiro vivo.', label: 'Dinheiro 💵' },
                    { id: 'cartao', name: 'Cartões ou Pix', desc: 'Pagamento presencial via cartão ou Pix com baixa manual pelo operador.', label: 'Cartões ou Pix 💳' },
                    { id: 'pagar_final', name: 'Pagar no Final', desc: 'Permitir que o cliente pague ao final do atendimento na mesa.', label: 'Pagar no Final 🍽️' }
                  ].map((method) => {
                    const map = storeConfig?.disabledPaymentMethodsByOrderType || {};
                    const disabledListForType = map[selectedOrderTypeFilter] || [];
                    const isDisabled = disabledListForType.includes(method.id);
                    const currentTheme = storeConfig?.paymentMethodsThemes?.[method.id] || 'dark';
                    return (
                      <div 
                        key={method.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '1rem',
                          background: 'rgba(255,255,255,0.01)',
                          border: '1px solid rgba(255,255,255,0.04)',
                          borderRadius: '12px',
                          transition: 'all 0.2s',
                          flexWrap: 'wrap',
                          gap: '1rem'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: 1, minWidth: '250px' }}>
                          {isAdmin ? (
                            <div style={{ position: 'relative' }}>
                              <input
                                type="text"
                                value={storeConfig?.paymentMethodsNames?.[method.id] ?? method.label}
                                onChange={(e) => {
                                  const names = storeConfig?.paymentMethodsNames || {};
                                  setStoreConfig(prev => prev ? {
                                    ...prev,
                                    paymentMethodsNames: { ...names, [method.id]: e.target.value }
                                  } : prev);
                                }}
                                placeholder={method.label}
                                title="Nome da forma de pagamento exibido ao cliente"
                                style={{
                                  fontWeight: 600,
                                  fontSize: '0.95rem',
                                  color: isDisabled ? 'var(--text-secondary)' : '#fff',
                                  background: 'transparent',
                                  border: 'none',
                                  borderBottom: '1px dashed rgba(255,255,255,0.15)',
                                  outline: 'none',
                                  padding: '2px 20px 2px 0',
                                  width: '100%',
                                  cursor: 'text',
                                  fontFamily: 'inherit'
                                }}
                              />
                              <Edit2 size={12} style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
                            </div>
                          ) : (
                            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: isDisabled ? 'var(--text-secondary)' : '#fff' }}>
                              {storeConfig?.paymentMethodsNames?.[method.id] ?? method.label}
                            </span>
                          )}
                          
                          {isAdmin ? (
                            <div style={{ position: 'relative' }}>
                              <input
                                type="text"
                                value={storeConfig?.paymentMethodsDescriptions?.[method.id] ?? method.desc}
                                onChange={(e) => {
                                  const descs = storeConfig?.paymentMethodsDescriptions || {};
                                  setStoreConfig(prev => prev ? {
                                    ...prev,
                                    paymentMethodsDescriptions: { ...descs, [method.id]: e.target.value }
                                  } : prev);
                                }}
                                placeholder={method.desc}
                                title="Descrição exibida ao cliente ao selecionar esta forma de pagamento"
                                style={{
                                  fontSize: '0.8rem',
                                  color: 'var(--text-secondary)',
                                  background: 'transparent',
                                  border: 'none',
                                  borderBottom: '1px dashed rgba(255,255,255,0.15)',
                                  outline: 'none',
                                  padding: '2px 20px 2px 0',
                                  width: '100%',
                                  cursor: 'text',
                                  fontFamily: 'inherit'
                                }}
                              />
                              <Edit2 size={10} style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                              {storeConfig?.paymentMethodsDescriptions?.[method.id] ?? method.desc}
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {/* Segmented Control for Theme Selection */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Tema:</span>
                            <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', padding: '2px' }}>
                              <button
                                type="button"
                                onClick={() => {
                                  const themes = storeConfig.paymentMethodsThemes || {};
                                  setStoreConfig(prev => prev ? {
                                    ...prev,
                                    paymentMethodsThemes: { ...themes, [method.id]: 'light' }
                                  } : prev);
                                }}
                                style={{
                                  background: currentTheme === 'light' ? 'var(--primary-gold)' : 'transparent',
                                  border: 'none',
                                  color: currentTheme === 'light' ? '#0b0f19' : 'var(--text-secondary)',
                                  padding: '0.25rem 0.75rem',
                                  borderRadius: '18px',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s',
                                }}
                              >
                                Claro
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const themes = storeConfig.paymentMethodsThemes || {};
                                  setStoreConfig(prev => prev ? {
                                    ...prev,
                                    paymentMethodsThemes: { ...themes, [method.id]: 'dark' }
                                  } : prev);
                                }}
                                style={{
                                  background: currentTheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'transparent',
                                  border: 'none',
                                  color: currentTheme === 'dark' ? '#ffffff' : 'var(--text-secondary)',
                                  padding: '0.25rem 0.75rem',
                                  borderRadius: '18px',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s',
                                }}
                              >
                                Escuro
                              </button>
                            </div>
                          </div>

                          {/* Visibility Checkboxes: Clientes / Funcionários */}
                          {(() => {
                            const visMap = storeConfig?.paymentMethodsVisibilityByOrderType?.[selectedOrderTypeFilter] || storeConfig?.paymentMethodsVisibility || {};
                            const vis = visMap[method.id] || 'both';
                            const showClient = vis === 'both' || vis === 'client';
                            const showStaff = vis === 'both' || vis === 'staff';
                            const setVis = (forClient: boolean, forStaff: boolean) => {
                              let newVis: 'client' | 'staff' | 'both' = 'both';
                              if (forClient && !forStaff) newVis = 'client';
                              else if (!forClient && forStaff) newVis = 'staff';
                              else newVis = 'both';
                              setStoreConfig(prev => {
                                if (!prev) return prev;
                                const prevMap = prev.paymentMethodsVisibilityByOrderType || {};
                                const orderTypeMap = prevMap[selectedOrderTypeFilter] || {};
                                return {
                                  ...prev,
                                  paymentMethodsVisibilityByOrderType: {
                                    ...prevMap,
                                    [selectedOrderTypeFilter]: {
                                      ...orderTypeMap,
                                      [method.id]: newVis
                                    }
                                  }
                                };
                              });
                            };
                            return (
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.07)',
                                borderRadius: '10px',
                                padding: '0.4rem 0.75rem'
                              }}>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>Visível para:</span>
                                <label
                                  title="Exibir para clientes"
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                                    cursor: 'pointer', userSelect: 'none', fontSize: '0.8rem',
                                    color: showClient ? '#34d399' : 'var(--text-secondary)',
                                    fontWeight: showClient ? 700 : 400,
                                    transition: 'color 0.2s'
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    id={`vis-client-${method.id}`}
                                    checked={showClient}
                                    onChange={(e) => setVis(e.target.checked, showStaff)}
                                    style={{ accentColor: '#34d399', width: '15px', height: '15px', cursor: 'pointer' }}
                                  />
                                  👤 Clientes
                                </label>
                                <label
                                  title="Exibir para funcionários"
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                                    cursor: 'pointer', userSelect: 'none', fontSize: '0.8rem',
                                    color: showStaff ? '#60a5fa' : 'var(--text-secondary)',
                                    fontWeight: showStaff ? 700 : 400,
                                    transition: 'color 0.2s'
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    id={`vis-staff-${method.id}`}
                                    checked={showStaff}
                                    onChange={(e) => setVis(showClient, e.target.checked)}
                                    style={{ accentColor: '#60a5fa', width: '15px', height: '15px', cursor: 'pointer' }}
                                  />
                                  🧑‍💼 Funcionários
                                </label>
                              </div>
                            );
                          })()}

                          {/* Toggle Switch */}
                          <button
                            type="button"
                            onClick={() => {
                              const map = storeConfig?.disabledPaymentMethodsByOrderType || {};
                              const disabledListForType = map[selectedOrderTypeFilter] || [];
                              let newList: string[];
                              if (isDisabled) {
                                newList = disabledListForType.filter((id: string) => id !== method.id);
                              } else {
                                newList = [...disabledListForType, method.id];
                              }
                              setStoreConfig(prev => prev ? {
                                ...prev,
                                disabledPaymentMethodsByOrderType: {
                                  ...map,
                                  [selectedOrderTypeFilter]: newList
                                }
                              } : prev);
                            }}
                            style={{
                              background: isDisabled ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              border: isDisabled ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
                              color: isDisabled ? '#ef4444' : '#10b981',
                              padding: '0.4rem 1rem',
                              borderRadius: '20px',
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              minWidth: '80px',
                              textAlign: 'center'
                            }}
                          >
                            {isDisabled ? 'Ocultado' : 'Ativo'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Opção de Exigir Aprovação do Caixa para pagamentos físicos */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  padding: '1.25rem',
                  borderRadius: '12px',
                  marginBottom: '2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <input
                      type="checkbox"
                      id="require-cashier-approval"
                      checked={storeConfig?.requireCashierApproval !== false}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setStoreConfig(prev => prev ? { ...prev, requireCashierApproval: val } : prev);
                      }}
                      style={{ 
                        width: '18px', 
                        height: '18px', 
                        accentColor: 'var(--primary-gold)', 
                        cursor: 'pointer' 
                      }}
                    />
                    <label 
                      htmlFor="require-cashier-approval" 
                      style={{ 
                        fontSize: '0.95rem', 
                        color: '#fff', 
                        fontWeight: 600,
                        cursor: 'pointer', 
                        userSelect: 'none' 
                      }}
                    >
                      Exigir aprovação do Caixa para pagamentos físicos
                    </label>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '1.75rem' }}>
                    Se ativado, pedidos em dinheiro ou com pagamento presencial via maquininha deverão ser autorizados manualmente pelo operador do Caixa antes de serem enviados para a cozinha. Se desativado, os pedidos irão diretamente para a produção.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={submittingPayments}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    background: 'var(--primary-gold)',
                    color: '#0b0f19',
                    border: 'none',
                    padding: '0.75rem 1.5rem',
                    borderRadius: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    transition: 'all 0.2s',
                    width: '200px'
                  }}
                >
                  <Save size={16} />
                  {submittingPayments ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </form>
            </div>
          )}

          {/* Aba Guia Maquininha Point */}
          {activeTab === 'point_guide' && isAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

              {/* ── SEÇÃO: CONFIGURAÇÃO AUTOMÁTICA ── */}
              <div style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(99,102,241,0.06) 100%)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: '16px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)', borderRadius: '8px', padding: '0.3rem 0.5rem', fontSize: '0.9rem' }}>⚡</span>
                      Configuração Automática
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      Busque as maquininhas diretamente da sua conta Mercado Pago, gerencie o modo PDV e salve tudo sem precisar copiar IDs manualmente.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleFetchDevices}
                    disabled={loadingDevices}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.65rem 1.4rem', borderRadius: '10px', border: 'none',
                      background: loadingDevices ? 'rgba(59,130,246,0.4)' : 'linear-gradient(135deg,#3b82f6,#6366f1)',
                      color: '#fff', fontWeight: 700, fontSize: '0.88rem',
                      cursor: loadingDevices ? 'wait' : 'pointer',
                      boxShadow: '0 4px 15px rgba(59,130,246,0.3)',
                      transition: 'all 0.2s', flexShrink: 0
                    }}
                  >
                    {loadingDevices ? (
                      <>
                        <div className="spinner" style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', flexShrink: 0 }} />
                        Buscando...
                      </>
                    ) : (
                      <>🔍 Buscar Maquininhas</>
                    )}
                  </button>
                </div>

                {/* Token missing warning */}
                {!storeConfig?.storeOwnerAccessToken && (
                  <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '10px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                    <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>⚠️</span>
                    <div style={{ fontSize: '0.83rem', color: '#fcd34d', lineHeight: 1.5 }}>
                      <strong>Token não configurado.</strong> Para usar a Configuração Automática, vá na aba <strong>Avançado</strong> e conecte a conta do estabelecimento via Mercado Pago OAuth.
                    </div>
                  </div>
                )}

                {/* Error message */}
                {deviceError && (
                  <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                    <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>❌</span>
                    <span style={{ fontSize: '0.83rem', color: '#fca5a5', lineHeight: 1.5 }}>{deviceError}</span>
                  </div>
                )}

                {/* Device Cards */}
                {pointDevices.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#93c5fd' }}>
                        📱 {pointDevices.length} maquininha{pointDevices.length !== 1 ? 's' : ''} encontrada{pointDevices.length !== 1 ? 's' : ''}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        Selecione o modelo, o caixa (POS) correspondente e ative o modo PDV
                      </span>
                    </div>

                    {/* Store / POS Creation UI */}
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                      {mpUserId && mpStores.length === 0 && (
                        <button type="button" onClick={handleCreateStore} disabled={creatingStorePos}
                          style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', padding: '0.5rem 1rem', color: '#60a5fa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {creatingStorePos ? 'Criando...' : '🏢 Criar Loja Matriz no MP'}
                        </button>
                      )}
                      {mpStores.length > 0 && mpPosList.length === 0 && (
                        <button type="button" onClick={handleCreatePos} disabled={creatingStorePos}
                          style={{ background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', padding: '0.5rem 1rem', color: '#60a5fa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {creatingStorePos ? 'Criando...' : '💻 Criar Caixa (POS) no MP'}
                        </button>
                      )}
                    </div>

                    {pointDevices.map((device) => {
                      const isPDV = device.operating_mode === 'PDV';
                      const isChangingMode = !!settingMode[device.id];
                      const assignedSlot = deviceModelMap[device.id] || '';
                      const modelOptions = [
                        { value: 'smart2', label: '📟 Point Smart 2' },
                        { value: 'pro3', label: '📟 Point Pro 3' },
                        { value: 'air2', label: '📡 Point Air 2' },
                        { value: 'mininfc2', label: '📱 Point Mini NFC 2' },
                      ];
                      // Short model name for display
                      const modelDisplay = device.model?.replace(/_/g, ' ') || 'Desconhecido';

                      return (
                        <div key={device.id} style={{
                          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '14px', padding: '1rem 1.25rem',
                          display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center',
                          transition: 'border-color 0.2s',
                          borderLeft: isPDV ? '3px solid #10b981' : '3px solid rgba(255,255,255,0.1)'
                        }}>
                          {/* Device info */}
                          <div style={{ flex: 1, minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.92rem', color: '#fff' }}>{modelDisplay}</span>
                              <span style={{
                                background: isPDV ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
                                border: isPDV ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.1)',
                                color: isPDV ? '#34d399' : 'var(--text-secondary)',
                                borderRadius: '20px', padding: '0.15rem 0.6rem', fontSize: '0.72rem', fontWeight: 700
                              }}>
                                {isPDV ? '✓ PDV' : '○ Autônomo'}
                              </span>
                            </div>
                            {device.serial_number && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                S/N: {device.serial_number}
                              </span>
                            )}
                            {device.external_store_id && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                Loja: {device.external_store_id} {device.external_pos_id ? `· Caixa: ${device.external_pos_id}` : ''}
                              </span>
                            )}
                            <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                              ID: {device.pos_id || device.id}
                            </span>
                          </div>

                          {/* Assign model */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '180px' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Este dispositivo é:</span>
                            <select
                              value={assignedSlot}
                              onChange={(e) => setDeviceModelMap(prev => ({ ...prev, [device.id]: e.target.value }))}
                              style={{
                                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '8px', padding: '0.4rem 0.6rem', color: '#fff', fontSize: '0.82rem',
                                cursor: 'pointer', outline: 'none'
                              }}
                            >
                              <option value="" style={{ background: '#1a1f2e' }}>— Não configurar —</option>
                              {modelOptions.map(opt => (
                                <option key={opt.value} value={opt.value} style={{ background: '#1a1f2e' }}>{opt.label}</option>
                              ))}
                            </select>
                            
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '0.3rem' }}>Caixa Vinculado (POS):</span>
                            <select
                              value={devicePosMap[device.id] || ''}
                              onChange={(e) => setDevicePosMap(prev => ({ ...prev, [device.id]: e.target.value }))}
                              style={{
                                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '8px', padding: '0.4rem 0.6rem', color: '#fff', fontSize: '0.82rem',
                                cursor: 'pointer', outline: 'none'
                              }}
                            >
                              <option value="" style={{ background: '#1a1f2e' }}>— Sem Caixa (Erro) —</option>
                              {mpPosList.map(pos => (
                                <option key={pos.id} value={String(pos.id)} style={{ background: '#1a1f2e' }}>
                                  {pos.name} (Loja {pos.store_id})
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* PDV Mode toggle */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Modo PDV</span>
                            <button
                              type="button"
                              onClick={() => handleSetDeviceMode(device.id, isPDV ? 'STANDALONE' : 'PDV')}
                              disabled={isChangingMode}
                              title={isPDV ? 'Clique para desativar o Modo PDV (voltar ao modo autônomo)' : 'Clique para ativar o Modo PDV (integração com o sistema)'}
                              style={{
                                position: 'relative', width: '52px', height: '28px', borderRadius: '14px', border: 'none',
                                background: isChangingMode ? 'rgba(255,255,255,0.1)' : (isPDV ? '#10b981' : 'rgba(255,255,255,0.1)'),
                                cursor: isChangingMode ? 'wait' : 'pointer', transition: 'background 0.3s', flexShrink: 0
                              }}
                            >
                              {isChangingMode ? (
                                <div className="spinner" style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }} />
                              ) : (
                                <div style={{
                                  position: 'absolute', top: '3px',
                                  left: isPDV ? '27px' : '3px',
                                  width: '22px', height: '22px', borderRadius: '50%',
                                  background: '#fff', transition: 'left 0.3s',
                                  boxShadow: '0 1px 4px rgba(0,0,0,0.3)'
                                }} />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Save selection button */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        💾 Ao salvar, os IDs são automaticamente preenchidos nos campos abaixo.
                      </p>
                      <button
                        type="button"
                        onClick={handleSaveDeviceSelection}
                        disabled={savingDeviceSelection || Object.values(deviceModelMap).every(v => !v)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.5rem',
                          padding: '0.65rem 1.5rem', borderRadius: '10px', border: 'none',
                          background: (savingDeviceSelection || Object.values(deviceModelMap).every(v => !v))
                            ? 'rgba(16,185,129,0.3)' : '#10b981',
                          color: '#fff', fontWeight: 700, fontSize: '0.88rem',
                          cursor: (savingDeviceSelection || Object.values(deviceModelMap).every(v => !v)) ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s'
                        }}
                      >
                        {savingDeviceSelection ? (
                          <>
                            <div className="spinner" style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', flexShrink: 0 }} />
                            Salvando...
                          </>
                        ) : '✅ Salvar Configuração'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Formulário de Configuração de IDs */}
              <form onSubmit={handleSaveStoreConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1rem' }}>
                <h4 style={{ margin: 0, color: 'var(--primary-gold)', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  ⚙️ Configurar IDs das Maquininhas Point
                </h4>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Insira o <strong>ID Interno</strong> numérico (obtido na busca automática acima) para cada maquininha correspondente. Se deixar em branco, o modelo não ficará integrado.
                </p>
                
                <div className="responsive-grid-2">
                  <div className="input-group">
                    <label>Point Smart 2</label>
                    <input
                      type="text"
                      className="pastel-edit-input"
                      placeholder="ID Interno (Ex: 118144954)"
                      value={storeConfig.pointSmart2Id || ''}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, pointSmart2Id: e.target.value }))}
                    />
                  </div>
                  <div className="input-group">
                    <label>Point Pro 3</label>
                    <input
                      type="text"
                      className="pastel-edit-input"
                      placeholder="Ex: CAIXA_PRO3"
                      value={storeConfig.pointPro3Id || ''}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, pointPro3Id: e.target.value }))}
                    />
                  </div>
                  <div className="input-group">
                    <label>Point Air 2</label>
                    <input
                      type="text"
                      className="pastel-edit-input"
                      placeholder="Ex: CAIXA_AIR2"
                      value={storeConfig.pointAir2Id || ''}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, pointAir2Id: e.target.value }))}
                    />
                  </div>
                  <div className="input-group">
                    <label>Point Mini NFC 2</label>
                    <input
                      type="text"
                      className="pastel-edit-input"
                      placeholder="Ex: CAIXA_MININFC2"
                      value={storeConfig.pointMiniNfc2Id || ''}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, pointMiniNfc2Id: e.target.value }))}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button
                    type="submit"
                    disabled={submittingStore}
                    className="auth-btn"
                    style={{ width: 'auto', padding: '0.6rem 2rem', fontSize: '0.85rem' }}
                  >
                    {submittingStore ? 'Salvando...' : 'Salvar IDs das Maquininhas'}
                  </button>
                </div>
              </form>

              {/* ── GUIA PRÁTICO — O QUE FAZER AGORA ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                {/* Cabeçalho */}
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem' }}>
                  <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.1rem' }}>
                    📋 O que fazer agora — Passo a Passo
                  </h3>
                  <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    As maquininhas já foram encontradas automaticamente acima. Siga este guia para concluir a configuração sem precisar de ajuda externa.
                  </p>
                </div>

                {/* PASSO A */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '14px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>A</span>
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>Identifique qual maquininha é qual</h4>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    As maquininhas apareceram como <strong style={{ color: '#fff' }}>"Unknown"</strong> porque a API do MP não retornou o modelo. Veja como descobrir qual ID corresponde a qual aparelho físico:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {/* Método 1 */}
                    <div style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#60a5fa', display: 'block', marginBottom: '0.4rem' }}>📊 MÉTODO 1 — Pelo painel do Mercado Pago (mais preciso)</span>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        <strong style={{ color: '#fff' }}>1.</strong> Abra: <a href="https://www.mercadopago.com.br/stores-and-pos" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>mercadopago.com.br/stores-and-pos</a><br />
                        <strong style={{ color: '#fff' }}>2.</strong> Clique em <strong style={{ color: '#fff' }}>Caixas</strong> — cada caixa cadastrado mostra o <strong style={{ color: '#fff' }}>nome que você deu</strong> + o ID numérico.<br />
                        <strong style={{ color: '#fff' }}>3.</strong> Compare os IDs de lá com os IDs exibidos nos cards acima (ex: <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>119579640</code>).
                      </p>
                    </div>
                    {/* Método 2 */}
                    <div style={{ background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#c084fc', display: 'block', marginBottom: '0.4rem' }}>🔌 MÉTODO 2 — Teste prático (mais rápido)</span>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        <strong style={{ color: '#fff' }}>1.</strong> Nos cards acima, ative o <strong style={{ color: '#fff' }}>toggle PDV</strong> em UMA maquininha de cada vez.<br />
                        <strong style={{ color: '#fff' }}>2.</strong> Olhe qual aparelho físico muda a tela para <em>"Aguardando integração"</em> — esse é o correspondente.<br />
                        <strong style={{ color: '#fff' }}>3.</strong> Anote e repita para as demais.
                      </p>
                    </div>
                  </div>
                </div>

                {/* PASSO B */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '14px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>B</span>
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>Associe cada dispositivo ao modelo correto</h4>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    Nos cards do <strong style={{ color: '#fff' }}>⚡ Configuração Automática</strong> acima, use o dropdown <strong style={{ color: '#fff' }}>"Este dispositivo é:"</strong> para cada maquininha:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {[
                      { model: 'Point Smart 2', desc: 'tela própria, botões físicos, design compacto' },
                      { model: 'Point Pro 3', desc: 'tela grande colorida, mais moderno' },
                      { model: 'Point Air 2', desc: '4G + WiFi + NFC, funciona sem celular' },
                      { model: 'Point Mini NFC 2', desc: 'pequenininho, conecta via Bluetooth ao celular' },
                    ].map(item => (
                      <div key={item.model} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '0.55rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#fff', minWidth: '140px' }}>📟 {item.model}</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{item.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* PASSO C */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '14px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>C</span>
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>Ative o Modo PDV (integrado) nas maquininhas</h4>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    Você pode fazer isso de <strong style={{ color: '#fff' }}>duas formas</strong> — pelo sistema aqui (mais fácil) <strong style={{ color: '#fff' }}>OU</strong> diretamente na maquininha:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#34d399', display: 'block', marginBottom: '0.4rem' }}>✅ OPÇÃO 1 — Pelo sistema (recomendado)</span>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        Nos cards acima, clique no <strong style={{ color: '#fff' }}>toggle "Modo PDV"</strong> para ativar (verde = integrado).<br />
                        Quando ficar verde, a maquininha muda automaticamente e exibe <em>"Aguardando integração"</em>.
                      </p>
                    </div>
                    <div style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#60a5fa', display: 'block', marginBottom: '0.4rem' }}>📟 OPÇÃO 2 — Direto na maquininha (Smart 2 / Pro 3 / Air 2)</span>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        <strong style={{ color: '#fff' }}>1.</strong> Na tela inicial, toque nos <strong style={{ color: '#fff' }}>3 pontinhos (⋮)</strong> no canto superior direito.<br />
                        <strong style={{ color: '#fff' }}>2.</strong> Procure: <strong style={{ color: '#fff' }}>"Modo PDV"</strong>, <strong style={{ color: '#fff' }}>"Modo integrado"</strong> ou <strong style={{ color: '#fff' }}>"Integração com sistema"</strong>.<br />
                        <strong style={{ color: '#fff' }}>3.</strong> Ative o toggle — a tela vai mostrar <em>"Aguardando integração"</em>.
                      </p>
                    </div>
                    <div style={{ background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#c084fc', display: 'block', marginBottom: '0.4rem' }}>📱 OPÇÃO 2 — Point Mini NFC 2 (via app no celular)</span>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        <strong style={{ color: '#fff' }}>1.</strong> Abra o app <strong style={{ color: '#fff' }}>Mercado Pago</strong> no celular já pareado com o Mini NFC 2.<br />
                        <strong style={{ color: '#fff' }}>2.</strong> Vá em <strong style={{ color: '#fff' }}>Cobrar → Minha maquininha → Configurações → Modo de uso</strong>.<br />
                        <strong style={{ color: '#fff' }}>3.</strong> Selecione <strong style={{ color: '#fff' }}>"PDV (Integrado)"</strong> e confirme.
                      </p>
                    </div>
                  </div>
                  <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '0.6rem 1rem', fontSize: '0.82rem', color: '#fca5a5' }}>
                    ⚠️ <strong>Atenção:</strong> Com o Modo PDV ativo, a maquininha <strong>não funciona mais de forma independente</strong>. Para usar manualmente (sem o sistema), desative o Modo PDV — ela volta ao normal.
                  </div>
                </div>

                {/* PASSO D */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '14px', padding: '1.25rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>D</span>
                    <h4 style={{ margin: 0, fontSize: '1rem' }}>Salve e teste o pagamento</h4>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    <p style={{ margin: 0 }}>
                      <strong style={{ color: '#fff' }}>1.</strong> No card de cada maquininha acima, selecione o modelo no dropdown e garanta que o toggle PDV está <strong style={{ color: '#34d399' }}>verde ✓</strong>.<br />
                      <strong style={{ color: '#fff' }}>2.</strong> Clique no botão <strong style={{ color: '#10b981' }}>✅ Salvar Configuração</strong> — os IDs são gravados automaticamente.<br />
                      <strong style={{ color: '#fff' }}>3.</strong> Teste: abra o cardápio digital, faça um pedido e escolha <strong style={{ color: '#fff' }}>"Débito Maquininha"</strong>.<br />
                      <strong style={{ color: '#fff' }}>4.</strong> A maquininha deve vibrar/acender e exibir o valor para passar o cartão. ✅
                    </p>
                  </div>
                  <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '8px', padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#34d399', lineHeight: 1.6 }}>
                    🎉 <strong>Pronto!</strong> A integração está completa. O débito e o crédito via maquininha passarão a funcionar automaticamente quando o cliente selecionar essa opção no cardápio digital.
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* Aba 1: Meu Perfil */}
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0 }}>Meu Perfil e Endereço</h3>
              
              <div className="responsive-grid-2">
                <div className="input-group">
                  <label>Nome Completo</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    value={profileName}
                    disabled
                    style={{ opacity: 0.6, cursor: 'not-allowed' }}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Definido via provedor de login</span>
                </div>
                <div className="input-group">
                  <label>E-mail</label>
                  <input
                    type="email"
                    className="pastel-edit-input"
                    value={user?.email || ''}
                    disabled
                    style={{ opacity: 0.6, cursor: 'not-allowed' }}
                  />
                </div>
              </div>

              <div className="responsive-grid-2">
                <div className="input-group">
                  <label>Celular (WhatsApp)</label>
                  <input
                    type="tel"
                    className="pastel-edit-input"
                    placeholder="(21) 99999-9999"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(formatPhone(e.target.value))}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>CPF do Titular</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="000.000.000-00"
                    value={profileCpf}
                    onChange={(e) => setProfileCpf(formatCpf(e.target.value))}
                    required
                  />
                </div>
              </div>

              <h4 style={{ margin: '0.5rem 0 0 0', color: 'var(--primary-gold)' }}>Endereço de Entrega Principal</h4>
              
              <div className="responsive-grid-street-number">
                <div className="input-group">
                  <label>Rua / Logradouro</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="Av. Cesário de Melo"
                    value={street}
                    onChange={(e) => setStreet(e.target.value)}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Número</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="123"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="responsive-grid-2">
                <div className="input-group">
                  <label>Bairro</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="Campo Grande"
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Cidade</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="Rio de Janeiro"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="responsive-grid-2">
                <div className="input-group">
                  <label>CEP</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="23000-000"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value.replace(/\D/g, '').replace(/(\d{5})(\d{3})/, '$1-$2'))}
                    maxLength={9}
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Complemento / Ponto de Referência</label>
                  <input
                    type="text"
                    className="pastel-edit-input"
                    placeholder="Apto 302, Bloco B"
                    value={complement}
                    onChange={(e) => setComplement(e.target.value)}
                  />
                </div>
              </div>

              {/* Seção Cartão Salvo */}
              <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--primary-gold)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CreditCard size={18} /> Cartão de Crédito no Cofre (PagBank)
                </h4>
                {userData?.pagbank_card_token ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div>
                      <strong style={{ textTransform: 'uppercase', color: '#fff' }}>{userData.pagbank_card_brand}</strong>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Terminado em **** {userData.pagbank_card_last_digits}</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveCard}
                      className="btn-small"
                      style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}
                    >
                      <Trash2 size={14} /> Excluir Cartão
                    </button>
                  </div>
                ) : (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>Nenhum cartão cadastrado no cofre atualmente. Você poderá salvar um cartão durante o checkout de novos pedidos.</p>
                )}
              </div>

              <button
                type="submit"
                disabled={submittingProfile}
                className="auth-btn auth-btn-login"
                style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '0.5rem', width: 'auto', padding: '0.6rem 2rem' }}
              >
                <Save size={16} />
                <span>{submittingProfile ? 'Salvando...' : 'Salvar Alterações'}</span>
              </button>
            </form>
          )}

          {/* Aba 2: Funcionamento da Loja */}
          {activeTab === 'store' && isAdmin && (
            <form onSubmit={handleSaveStoreConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0 }}>Funcionamento da Pastelaria</h3>
              
              {loadingStore ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                  <div className="spinner" style={{ width: '18px', height: '18px' }} />
                  <span>Carregando parâmetros operacionais...</span>
                </div>
              ) : (
                <>
                  {/* Status Aberto/Fechado */}
                  <div className="input-group" style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ fontSize: '1rem', color: '#fff' }}>Status da Loja (Novos Pedidos)</strong>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {storeConfig.isOpen 
                          ? '🟢 Loja aberta e recebendo pedidos normalmente.' 
                          : '🔴 Loja fechada. Clientes não conseguirão fechar o carrinho.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleToggleStoreOpen}
                      style={{
                        background: storeConfig.isOpen ? '#059669' : '#dc2626',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '24px',
                        padding: '0.5rem 1.5rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {storeConfig.isOpen ? 'ABERTO' : 'FECHADO'}
                    </button>
                  </div>

                  {/* Fechamento Excepcional (Hoje) */}
                  <div style={{
                    background: 'rgba(255,255,255,0.01)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '12px',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong style={{ fontSize: '1.05rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          ⚠️ Fechamento Excepcional (Hoje)
                        </strong>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          Ative esta opção caso precise fechar a pastelaria hoje excepcionalmente (ex: feriado, folga).
                        </p>
                      </div>
                      <label style={{ position: 'relative', display: 'inline-block', width: '50px', height: '26px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={storeConfig.isTemporarilyClosed || false}
                          onChange={(e) => setStoreConfig(prev => ({ ...prev, isTemporarilyClosed: e.target.checked }))}
                          style={{ opacity: 0, width: 0, height: 0 }}
                        />
                        <span style={{
                          position: 'absolute',
                          cursor: 'pointer',
                          top: 0, left: 0, right: 0, bottom: 0,
                          backgroundColor: storeConfig.isTemporarilyClosed ? 'var(--primary-gold)' : '#475569',
                          transition: '0.4s',
                          borderRadius: '34px'
                        }}>
                          <span style={{
                            position: 'absolute',
                            content: '""',
                            height: '18px',
                            width: '18px',
                            left: '4px',
                            bottom: '4px',
                            backgroundColor: '#fff',
                            transition: '0.4s',
                            borderRadius: '50%',
                            transform: storeConfig.isTemporarilyClosed ? 'translateX(24px)' : 'none'
                          }} />
                        </span>
                      </label>
                    </div>

                    {storeConfig.isTemporarilyClosed && (
                      <div className="input-group animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', transition: 'all 0.3s' }}>
                        <label style={{ fontSize: '0.85rem', color: 'var(--primary-gold)', fontWeight: 600 }}>
                          Escreva a mensagem que os clientes visualizarão:
                        </label>
                        <textarea
                          className="pastel-edit-input"
                          placeholder="Ex: Hoje não estamos funcionando devido a um treinamento interno da equipe. Retornaremos amanhã a partir das 18h!"
                          value={storeConfig.temporaryCloseReason || ''}
                          onChange={(e) => setStoreConfig(prev => ({ ...prev, temporaryCloseReason: e.target.value }))}
                          style={{
                            minHeight: '80px',
                            resize: 'vertical',
                            padding: '0.6rem',
                            fontSize: '0.9rem',
                            lineHeight: '1.4',
                            borderRadius: '8px',
                            background: 'rgba(0,0,0,0.2)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: '#fff'
                          }}
                          required={storeConfig.isTemporarilyClosed}
                        />
                      </div>
                    )}
                  </div>

                  {/* Horários */}
                  <div className="responsive-grid-2">
                    <div className="input-group">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Clock size={14} /> Horário de Abertura
                      </label>
                      <input
                        type="text"
                        className="pastel-edit-input"
                        placeholder="18:00"
                        value={storeConfig.openingTime}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, openingTime: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="input-group">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Clock size={14} /> Horário de Fechamento
                      </label>
                      <input
                        type="text"
                        className="pastel-edit-input"
                        placeholder="23:30"
                        value={storeConfig.closingTime}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, closingTime: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  {/* Dias de Funcionamento */}
                  <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <strong style={{ fontSize: '1rem', color: '#fff' }}>📅 Dias de Funcionamento</strong>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Selecione os dias da semana em que a pastelaria abre para receber pedidos.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                      {[
                        { label: 'Dom', index: 0 },
                        { label: 'Seg', index: 1 },
                        { label: 'Ter', index: 2 },
                        { label: 'Qua', index: 3 },
                        { label: 'Qui', index: 4 },
                        { label: 'Sex', index: 5 },
                        { label: 'Sáb', index: 6 }
                      ].map((day) => {
                        const currentOpenDays = storeConfig.openDays || [0, 1, 2, 3, 4, 5, 6];
                        const isChecked = currentOpenDays.includes(day.index) || currentOpenDays.includes(day.index.toString());
                        
                        const handleDayToggle = () => {
                          let newList = [...currentOpenDays].map(Number);
                          if (isChecked) {
                            newList = newList.filter(d => d !== day.index);
                          } else {
                            newList.push(day.index);
                          }
                          setStoreConfig(prev => ({ ...prev, openDays: newList }));
                        };

                        return (
                          <label key={day.index} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: isChecked ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)', border: isChecked ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '0.4rem 0.8rem', fontSize: '0.85rem', color: '#fff', cursor: 'pointer', userSelect: 'none', transition: 'all 0.2s' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={handleDayToggle}
                              style={{ accentColor: 'var(--primary-gold)', cursor: 'pointer', width: '15px', height: '15px' }}
                            />
                            {day.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Esquema de Taxa de Entrega */}
                  <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <strong style={{ fontSize: '1rem', color: '#fff' }}>🛵 Esquema de Taxa de Entrega</strong>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Configure a taxa de entrega baseada na distância calculada por geolocalização.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
                      <div className="input-group">
                        <label>Valor Base (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="pastel-edit-input"
                          value={storeConfig.deliveryBaseFee !== undefined ? storeConfig.deliveryBaseFee : 5.00}
                          onChange={(e) => setStoreConfig(prev => ({ ...prev, deliveryBaseFee: parseFloat(e.target.value) || 0 }))}
                          required
                        />
                      </div>
                      <div className="input-group">
                        <label>Distância Base (Km)</label>
                        <input
                          type="number"
                          step="0.1"
                          className="pastel-edit-input"
                          value={storeConfig.deliveryBaseKm !== undefined ? storeConfig.deliveryBaseKm : 3.0}
                          onChange={(e) => setStoreConfig(prev => ({ ...prev, deliveryBaseKm: parseFloat(e.target.value) || 0 }))}
                          required
                        />
                      </div>
                      <div className="input-group">
                        <label>Valor por Km Adicional (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="pastel-edit-input"
                          value={storeConfig.deliveryAdditionalKmFee !== undefined ? storeConfig.deliveryAdditionalKmFee : 1.00}
                          onChange={(e) => setStoreConfig(prev => ({ ...prev, deliveryAdditionalKmFee: parseFloat(e.target.value) || 0 }))}
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Endereço e Contato */}
                  <div className="input-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <MapPin size={14} /> Endereço Físico Exibido
                    </label>
                    <input
                      type="text"
                      className="pastel-edit-input"
                      value={storeConfig.storeAddress}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, storeAddress: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="input-group" style={{ maxWidth: '280px' }}>
                    <label>Telefone de Contato Exibido</label>
                    <input
                      type="text"
                      className="pastel-edit-input"
                      value={storeConfig.phoneContact}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, phoneContact: e.target.value }))}
                      required
                    />
                  </div>

                  {/* Seção de Ingredientes Adicionais */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1.5rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--primary-gold)' }}>⚙️ Gestão de Ingredientes Adicionais</h3>
                    
                    <div className="responsive-grid-2">
                      <div className="input-group">
                        <label>Quantidade Máxima Permitida por Pastel</label>
                        <input
                          type="number"
                          className="pastel-edit-input"
                          min="1"
                          max="20"
                          value={storeConfig.maxIngredientsLimit !== undefined ? storeConfig.maxIngredientsLimit : 5}
                          onChange={(e) => setStoreConfig(prev => ({ ...prev, maxIngredientsLimit: parseInt(e.target.value) || 5 }))}
                          required
                        />
                      </div>
                      <div className="input-group">
                        <label>Cadastrar Novo Ingrediente</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <input
                            type="text"
                            id="new-ingredient-input"
                            className="pastel-edit-input"
                            placeholder="Ex: Cheddar, Palmito"
                            style={{ flex: 1 }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const val = e.currentTarget.value.trim();
                                if (val) {
                                  const currentList = storeConfig.availableIngredients || ['Palmito', 'Alho poró', 'Tomate', 'Cebola', 'Alho torrado', 'Ovo', 'Azeitona verde', 'Azeitona Preta', 'Milho', 'Ervilha', 'Orégano', 'Calabresa', 'Bacon'];
                                  if (!currentList.includes(val)) {
                                    setStoreConfig(prev => ({
                                      ...prev,
                                      availableIngredients: [...currentList, val]
                                    }));
                                  }
                                  e.currentTarget.value = '';
                                }
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const input = document.getElementById('new-ingredient-input') as HTMLInputElement;
                              const val = input?.value.trim();
                              if (val) {
                                const currentList = storeConfig.availableIngredients || ['Palmito', 'Alho poró', 'Tomate', 'Cebola', 'Alho torrado', 'Ovo', 'Azeitona verde', 'Azeitona Preta', 'Milho', 'Ervilha', 'Orégano', 'Calabresa', 'Bacon'];
                                if (!currentList.includes(val)) {
                                  setStoreConfig(prev => ({
                                    ...prev,
                                    availableIngredients: [...currentList, val]
                                  }));
                                }
                                if (input) input.value = '';
                              }
                            }}
                            style={{
                              background: 'var(--primary-gold)',
                              color: '#000',
                              border: 'none',
                              borderRadius: '8px',
                              padding: '0 1rem',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="input-group">
                      <label>Ingredientes Cadastrados ({ (storeConfig.availableIngredients || ['Palmito', 'Alho poró', 'Tomate', 'Cebola', 'Alho torrado', 'Ovo', 'Azeitona verde', 'Azeitona Preta', 'Milho', 'Ervilha', 'Orégano', 'Calabresa', 'Bacon']).length })</label>
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                        background: 'rgba(255,255,255,0.01)',
                        border: '1px solid rgba(255,255,255,0.04)',
                        borderRadius: '12px',
                        padding: '0.75rem',
                        minHeight: '60px'
                      }}>
                        {(storeConfig.availableIngredients || ['Palmito', 'Alho poró', 'Tomate', 'Cebola', 'Alho torrado', 'Ovo', 'Azeitona verde', 'Azeitona Preta', 'Milho', 'Ervilha', 'Orégano', 'Calabresa', 'Bacon']).map((ing, index) => (
                          <div
                            key={ing + "-" + index}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              background: 'rgba(245,158,11,0.1)',
                              border: '1px solid rgba(245,158,11,0.2)',
                              color: 'var(--primary-gold)',
                              borderRadius: '8px',
                              padding: '0.3rem 0.6rem',
                              fontSize: '0.8rem',
                              fontWeight: 600
                            }}
                          >
                            <span>{ing}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const currentList = storeConfig.availableIngredients || ['Palmito', 'Alho poró', 'Tomate', 'Cebola', 'Alho torrado', 'Ovo', 'Azeitona verde', 'Azeitona Preta', 'Milho', 'Ervilha', 'Orégano', 'Calabresa', 'Bacon'];
                                setStoreConfig(prev => ({
                                  ...prev,
                                  availableIngredients: currentList.filter(i => i !== ing)
                                }));
                              }}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'rgba(255,255,255,0.4)',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                padding: '0 0.1rem',
                                display: 'flex',
                                alignItems: 'center'
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submittingStore}
                    className="auth-btn auth-btn-login"
                    style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '0.5rem', width: 'auto', padding: '0.6rem 2rem' }}
                  >
                    <Save size={16} />
                    <span>{submittingStore ? 'Gravando...' : 'Gravar Configurações'}</span>
                  </button>
                </>
              )}
            </form>
          )}

          {/* Aba 3: Fidelidade */}
          {activeTab === 'loyalty' && isAdmin && (
            <form onSubmit={handleSaveStoreConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0 }}>Regras do Cartão Fidelidade</h3>

              <div className="input-group" style={{ maxWidth: '300px' }}>
                <label>Carimbos necessários para pastel grátis</label>
                <input
                  type="number"
                  className="pastel-edit-input"
                  value={storeConfig.stampsNeeded}
                  onChange={(e) => setStoreConfig(prev => ({ ...prev, stampsNeeded: parseInt(e.target.value) || 10 }))}
                  min="5"
                  max="20"
                  required
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Por padrão, o cliente acumula 1 carimbo por pedido concluído e resgata ao completar esta meta.</span>
              </div>

              <button
                type="submit"
                disabled={submittingStore}
                className="auth-btn auth-btn-login"
                style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '0.5rem', width: 'auto', padding: '0.6rem 2rem' }}
              >
                <Save size={16} />
                <span>{submittingStore ? 'Salvar Regras' : 'Salvar Regras'}</span>
              </button>
            </form>
          )}

          {/* Aba 4: Avançado Dev */}
          {activeTab === 'advanced' && (isDev || role === 'owner') && (
            <form onSubmit={handleSaveDevMPConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0, color: '#a855f7' }}>Split de Pagamentos & Mercado Pago 💳</h3>
                <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Configure as regras de repasse (split) de vendas automatizadas entre a conta de manutenção do desenvolvedor e a conta do estabelecimento.
                </p>
              </div>

              {/* 1. Escolha da porcentagem do Split */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.25rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.75rem', color: 'var(--primary-gold)' }}>
                  Opções de Divisão (Split)
                </label>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {[
                    { pct: 1, label: '1% Dev / 99% Loja (Padrão)' },
                    { pct: 5, label: '5% Dev / 95% Loja' },
                    { pct: 10, label: '10% Dev / 90% Loja' },
                    { pct: 0, label: 'Sem Split (100% Loja)' }
                  ].map((option) => {
                    const isSelected = (storeConfig.devPercentage ?? 1) === option.pct;
                    const disabled = !isDev;
                    return (
                      <button
                        key={option.pct}
                        type="button"
                        disabled={disabled}
                        onClick={() => setStoreConfig(prev => ({ ...prev, devPercentage: option.pct }))}
                        style={{
                          padding: '0.6rem 1rem',
                          borderRadius: '8px',
                          border: isSelected ? '1px solid var(--primary-gold)' : '1px solid rgba(255, 255, 255, 0.08)',
                          background: isSelected ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                          color: isSelected ? 'var(--primary-gold)' : 'var(--text-secondary)',
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          opacity: disabled ? 0.6 : 1,
                          fontWeight: 600,
                          fontSize: '0.85rem',
                          transition: 'all 0.2s'
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Configuração do Desenvolvedor */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', color: '#a855f7' }}>
                  Conta do Desenvolvedor (Recebe {storeConfig.devPercentage ?? 1}%)
                </label>
                <div className="responsive-grid-2">
                  <div className="input-group">
                    <label>Mercado Pago Client ID (Dev)</label>
                    <input
                      type="text"
                      className="pastel-edit-input"
                      placeholder="Ex: 87878437306"
                      value={storeConfig.devClientId || ''}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, devClientId: e.target.value }))}
                      disabled={!isDev}
                      style={!isDev ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                    />
                  </div>
                  <div className="input-group">
                    <label>Access Token de Produção (Dev)</label>
                    <input
                      type="password"
                      className="pastel-edit-input"
                      placeholder="Ex: APP_USR-..."
                      value={storeConfig.devAccessToken || ''}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, devAccessToken: e.target.value }))}
                      disabled={!isDev}
                      style={!isDev ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                    />
                  </div>
                  <div className="input-group">
                    <label>Public Key (Dev)</label>
                    <input
                      type="text"
                      className="pastel-edit-input"
                      placeholder="Ex: APP_USR-..."
                      value={storeConfig.mpPublicKey || ''}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, mpPublicKey: e.target.value }))}
                      disabled={!isDev}
                      style={!isDev ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
                    />
                  </div>
                </div>
              </div>

              {/* 3. Conexão do Estabelecimento */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', color: '#38bdf8' }}>
                  Conta do Estabelecimento (Recebe {100 - (storeConfig.devPercentage ?? 1)}%)
                </label>

                {exchangingOAuth ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: 'rgba(0, 158, 227, 0.08)', border: '1px solid rgba(0, 158, 227, 0.2)', borderRadius: '8px' }}>
                    <div className="spinner" style={{ width: '18px', height: '18px', border: '2px solid rgba(0,158,227,0.2)', borderTopColor: '#009ee3', flexShrink: 0 }} />
                    <span style={{ color: '#38bdf8', fontSize: '0.85rem', fontWeight: 600 }}>Conectando conta ao Mercado Pago... aguarde</span>
                  </div>
                ) : storeConfig.storeOwnerEmail && storeConfig.storeOwnerAccessToken && !storeConfig.storeOwnerAccessToken.includes('MOCK') ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.15)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                      <span style={{ color: '#34d399', fontSize: '0.85rem', fontWeight: 600 }}>✓ Conectado via Mercado Pago</span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>E-mail: {storeConfig.storeOwnerEmail}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStoreConfig(prev => ({ ...prev, storeOwnerEmail: '', storeOwnerAccessToken: '' }))}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        textDecoration: 'underline'
                      }}
                    >
                      Desconectar conta
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Nenhuma conta do estabelecimento conectada para receber os {100 - (storeConfig.devPercentage ?? 1)}% restantes das vendas.
                    </p>
                    <button
                      type="button"
                      onClick={handleLoginEstablishment}
                      disabled={!storeConfig.devClientId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.6rem',
                        padding: '0.65rem 1.25rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: storeConfig.devClientId ? '#009ee3' : 'rgba(255,255,255,0.1)',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        cursor: storeConfig.devClientId ? 'pointer' : 'not-allowed',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={(e) => { if (storeConfig.devClientId) e.currentTarget.style.background = '#0082c5'; }}
                      onMouseLeave={(e) => { if (storeConfig.devClientId) e.currentTarget.style.background = '#009ee3'; }}
                    >
                      <span>Conectar com Mercado Pago ({100 - (storeConfig.devPercentage ?? 1)}%)</span>
                    </button>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
                      ⚠️ Requer a variável de ambiente <strong style={{ color: 'rgba(255,255,255,0.55)' }}>MP_APP_SECRET</strong> configurada no Vercel com o Client Secret da sua aplicação MP.
                    </p>
                  </div>
                )}

              </div>

              {/* 4. Configuração Stone */}
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', color: '#10b981' }}>
                    Configurações Stone (Pagar.me V5)
                  </label>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={storeConfig.stoneEnabled || false}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, stoneEnabled: e.target.checked }))}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
                
                {storeConfig.stoneEnabled && (
                  <div className="responsive-grid-2">
                    <div className="input-group">
                      <label>Stone Secret Key (sk_...)</label>
                      <input
                        type="password"
                        className="pastel-edit-input"
                        placeholder="Ex: sk_test_..."
                        value={storeConfig.stoneAccessToken || ''}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, stoneAccessToken: e.target.value }))}
                      />
                    </div>
                    <div className="input-group">
                      <label>Stone Public Key (pk_...)</label>
                      <input
                        type="text"
                        className="pastel-edit-input"
                        placeholder="Ex: pk_test_..."
                        value={storeConfig.stonePublicKey || ''}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, stonePublicKey: e.target.value }))}
                      />
                    </div>
                    <div className="input-group">
                      <label>Webhook Secret</label>
                      <input
                        type="password"
                        className="pastel-edit-input"
                        placeholder="Usado para validar retornos"
                        value={storeConfig.stoneWebhookSecret || ''}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, stoneWebhookSecret: e.target.value }))}
                      />
                    </div>
                    <div className="input-group">
                      <label>Terminal ID (Maquininha Stone)</label>
                      <input
                        type="text"
                        className="pastel-edit-input"
                        placeholder="Ex: 00000000"
                        value={storeConfig.stoneTerminalId || ''}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, stoneTerminalId: e.target.value }))}
                      />
                    </div>
                  </div>
                )}

                {storeConfig.stoneEnabled && (role === 'owner' || isDev) && (
                  <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                    <h4 style={{ color: '#10b981', fontSize: '0.85rem', marginBottom: '1rem' }}>
                      Conta do Estabelecimento (Split Stone)
                    </h4>
                    {storeConfig.stoneRecipientId ? (
                      <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', padding: '1rem', borderRadius: '8px' }}>
                        <p style={{ margin: 0, color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>
                          ✓ Conta conectada via Pagar.me
                        </p>
                        <p style={{ margin: '0.25rem 0 0', color: 'rgba(255,255,255,0.7)', fontSize: '0.75rem' }}>
                          ID do Recebedor: {storeConfig.stoneRecipientId}
                        </p>
                      </div>
                    ) : (
                      <>
                        <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginBottom: '1rem' }}>
                          Preencha os dados bancários do proprietário para ativar o Split automático. Os pagamentos da Stone cairão diretamente nesta conta.
                        </p>
                        <div className="responsive-grid-2">
                          <div className="input-group">
                            <label>Nome Completo (ou Razão Social)</label>
                            <input type="text" className="pastel-edit-input" value={stoneName} onChange={e => setStoneName(e.target.value)} />
                          </div>
                          <div className="input-group">
                            <label>Email</label>
                            <input type="email" className="pastel-edit-input" value={stoneEmail} onChange={e => setStoneEmail(e.target.value)} />
                          </div>
                          <div className="input-group">
                            <label>CPF ou CNPJ</label>
                            <input type="text" className="pastel-edit-input" value={stoneDocument} onChange={e => setStoneDocument(e.target.value)} />
                          </div>
                          <div className="input-group">
                            <label>Código do Banco</label>
                            <input type="text" className="pastel-edit-input" placeholder="Ex: 341 (Itaú)" value={stoneBank} onChange={e => setStoneBank(e.target.value)} />
                          </div>
                          <div className="input-group">
                            <label>Agência e Dígito</label>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <input type="text" className="pastel-edit-input" placeholder="Agência" value={stoneBranch} onChange={e => setStoneBranch(e.target.value)} />
                              <input type="text" className="pastel-edit-input" placeholder="Dígito" style={{ width: '60px' }} value={stoneBranchDigit} onChange={e => setStoneBranchDigit(e.target.value)} />
                            </div>
                          </div>
                          <div className="input-group">
                            <label>Conta, Dígito e Tipo</label>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <input type="text" className="pastel-edit-input" placeholder="Conta" value={stoneAccount} onChange={e => setStoneAccount(e.target.value)} />
                              <input type="text" className="pastel-edit-input" placeholder="Dígito" style={{ width: '60px' }} value={stoneAccountDigit} onChange={e => setStoneAccountDigit(e.target.value)} />
                              <select className="pastel-edit-input" style={{ width: '100px' }} value={stoneAccountType} onChange={e => setStoneAccountType(e.target.value as any)}>
                                <option value="checking">Corrente</option>
                                <option value="savings">Poupança</option>
                              </select>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleCreateStoneRecipient}
                          disabled={creatingStoneRecipient}
                          style={{
                            marginTop: '1rem',
                            padding: '0.6rem 1rem',
                            background: creatingStoneRecipient ? '#4b5563' : '#10b981',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            fontWeight: 600,
                            cursor: creatingStoneRecipient ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {creatingStoneRecipient ? 'Conectando...' : 'Conectar Conta Bancária'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <AlertCircle size={14} style={{ color: 'var(--primary-gold)' }} />
                  <span>Configurações salvas diretamente no banco de dados.</span>
                </div>
                <button
                  type="submit"
                  disabled={submittingDevMP}
                  className="auth-btn auth-btn-login"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: 'auto', padding: '0.6rem 2rem', margin: 0 }}
                >
                  <Save size={16} />
                  <span>{submittingDevMP ? 'Salvando...' : 'Salvar Configurações do Split'}</span>
                </button>
              </div>
            </form>
          )}
          {/* Aba 5: Logs de Auditoria */}
          {activeTab === 'audit_logs' && isAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0 }}>Histórico Visível (Timeline)</h3>
                <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Sempre que um administrador realizar uma ação crítica no banco de dados (ex: deletar), isso ficará guardado aqui em formato fácil de ler.
                </p>
              </div>

              {loadingLogs ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                  <div className="spinner" style={{ width: '32px', height: '32px', border: '3px solid rgba(245, 158, 11, 0.1)', borderTopColor: 'var(--primary-gold)' }} />
                </div>
              ) : auditLogs.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.1)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)' }}>
                  Nenhum log de auditoria encontrado.
                </div>
              ) : (
                <div style={{ position: 'relative', borderLeft: '2px solid rgba(255, 255, 255, 0.05)', paddingLeft: '0.5rem', margin: '0.5rem 0 0 0.5rem' }}>
                  {auditLogs.map((log) => (
                    <div key={log.id} style={{ position: 'relative', paddingLeft: '2rem', marginBottom: '1.75rem' }}>
                      {/* Círculo do timeline com o ícone */}
                      <div style={{
                        position: 'absolute',
                        left: '-33px', // centraliza perfeitamente o círculo de 24px sobre a borda esquerda de 2px
                        top: '4px',
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: getBadgeBackground(log.actionType),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '2px solid #141010'
                      }}>
                        {getIconComponent(log.actionType)}
                      </div>

                      {/* Card do log */}
                      <div style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: '12px',
                        padding: '1.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {log.title}
                          </h4>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString('pt-BR') : new Date(log.timestamp).toLocaleString('pt-BR')}
                          </span>
                        </div>

                        <div style={{
                          background: 'rgba(0, 0, 0, 0.15)',
                          border: '1px solid rgba(255, 255, 255, 0.03)',
                          borderRadius: '8px',
                          padding: '0.75rem 1rem',
                          fontSize: '0.9rem',
                          color: 'var(--text-secondary)',
                          lineHeight: '1.4'
                        }}>
                          {log.description}
                        </div>

                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', opacity: 0.8 }}>
                          Resp: <span style={{ color: 'var(--primary-gold)' }}>{log.userEmail}</span> • Tipo: <code style={{ color: '#a855f7' }}>{log.actionType}</code>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Aba 6: Fechamento de Comissões */}
          {activeTab === 'commissions' && isAdmin && (() => {
            const weeklyPeriod = getWeeklyPeriod();
            const monthlyPeriod = getMonthlyPeriod();
            const weeklyOrders = filterOfflineOrders(weeklyPeriod.start, weeklyPeriod.end);
            const monthlyOrders = filterOfflineOrders(monthlyPeriod.start, monthlyPeriod.end);
            
            const pct = storeConfig.devPercentage ?? 1;
            
            const totalWeeklySales = weeklyOrders.reduce((sum, o) => sum + o.total, 0);
            const weeklyCommissions = totalWeeklySales * (pct / 100);
            
            const totalMonthlySales = monthlyOrders.reduce((sum, o) => sum + o.total, 0);
            const monthlyCommissions = totalMonthlySales * (pct / 100);

            const displayPaymentMethod = (method: string) => {
              switch (method) {
                case 'dinheiro': return '💵 Dinheiro';
                case 'pix': return '📱 Pix Manual';
                case 'debito': return 'Debito (Maquininha)';
                case 'credito': return 'Credito (Maquininha)';
                default: return method;
              }
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div>
                  <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0, color: 'var(--primary-gold)' }}>Fechamento de Comissões (Faturamento Dev) 💼</h3>
                  <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    Visualize e gerencie os valores a pagar referentes à taxa de comissão de <strong>{pct}%</strong> sobre as vendas realizadas por fora do split online.
                  </p>
                </div>

                {/* Filtros de Métodos de Pagamento Offline */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.25rem' }}>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
                    Métodos de Pagamento Sujeitos a Comissão
                  </label>
                  <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={billDinheiro} onChange={(e) => setBillDinheiro(e.target.checked)} />
                      <span>Dinheiro em Espécie</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={billPix} onChange={(e) => setBillPix(e.target.checked)} />
                      <span>Pix por fora do sistema</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={billDebito} onChange={(e) => setBillDebito(e.target.checked)} />
                      <span>Cartão de Débito (Maquininha)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={billCredito} onChange={(e) => setBillCredito(e.target.checked)} />
                      <span>Cartão de Crédito (Maquininha/Não integrado)</span>
                    </label>
                  </div>
                </div>

                {/* Grid dos Fechamentos */}
                <div className="responsive-grid-2" style={{ gap: '1.5rem' }}>
                  
                  {/* Semana */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fechamento Semanal</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.6rem', borderRadius: '20px' }}>Toda Segunda-feira</span>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Período Atual:</div>
                      <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 600 }}>
                        {weeklyPeriod.start.toLocaleDateString('pt-BR')} a {weeklyPeriod.end.toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <div className="responsive-grid-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Vendas Offline:</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>R$ {totalWeeklySales.toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Taxa Dev ({pct}%):</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary-gold)' }}>R$ {weeklyCommissions.toFixed(2)}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => alert(`Relatório semanal gerado! Total da comissão a pagar para o desenvolvedor: R$ ${weeklyCommissions.toFixed(2)}.`)}
                      style={{ marginTop: '0.5rem', padding: '0.65rem', border: 'none', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.2)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'}
                    >
                      Fechar Semana & Cobrar
                    </button>
                  </div>

                  {/* Mensal */}
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', color: '#a855f7', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fechamento Mensal</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.6rem', borderRadius: '20px' }}>Todo dia 10</span>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Período Atual:</div>
                      <div style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 600 }}>
                        {monthlyPeriod.start.toLocaleDateString('pt-BR')} a {monthlyPeriod.end.toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <div className="responsive-grid-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Vendas Offline:</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fff' }}>R$ {totalMonthlySales.toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Taxa Dev ({pct}%):</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary-gold)' }}>R$ {monthlyCommissions.toFixed(2)}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => alert(`Relatório mensal gerado! Total da comissão a pagar para o desenvolvedor: R$ ${monthlyCommissions.toFixed(2)}.`)}
                      style={{ marginTop: '0.5rem', padding: '0.65rem', border: 'none', borderRadius: '8px', background: 'rgba(168, 85, 247, 0.1)', color: '#c084fc', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.2)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.1)'}
                    >
                      Fechar Mês & Cobrar
                    </button>
                  </div>

                </div>

                {/* Tabela de Pedidos do Período Atual */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', padding: '1.25rem', overflow: 'hidden' }}>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
                    Detalhamento dos Pedidos no Período
                  </label>
                  
                  {loadingOrders ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                      <div className="spinner" style={{ width: '24px', height: '24px', border: '2px solid rgba(245, 158, 11, 0.1)', borderTopColor: 'var(--primary-gold)' }} />
                    </div>
                  ) : [...weeklyOrders, ...monthlyOrders].length === 0 ? (
                    <p style={{ margin: '1rem 0', color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center' }}>
                      Nenhum pedido offline concluído no período atual.
                    </p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>ID Pedido</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>Data/Hora</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>Cliente</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>Pagamento</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', textAlign: 'right' }}>Total</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)', textAlign: 'right' }}>Comissão ({pct}%)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from(new Set([...weeklyOrders, ...monthlyOrders])).map((order) => {
                            const commVal = order.total * (pct / 100);
                            return (
                              <tr key={order.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>#{order.dailySeq || order.id?.substring(0, 5).toUpperCase()}</td>
                                <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>{new Date(order.createdAt).toLocaleString('pt-BR')}</td>
                                <td style={{ padding: '0.75rem 0.5rem' }}>{order.clientName}</td>
                                <td style={{ padding: '0.75rem 0.5rem' }}>{displayPaymentMethod(order.paymentMethod)}</td>
                                <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>R$ {order.total.toFixed(2)}</td>
                                <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 600, color: 'var(--primary-gold)' }}>R$ {commVal.toFixed(2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Aba 7: Segurança e Câmeras IP */}
          {activeTab === 'security' && (isDev || role === 'owner') && (
            <SecurityCameraSettings />
          )}

          {/* Aba 8: Impressora Bluetooth */}
          {activeTab === 'printer' && (isAdmin || role === 'staff') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0, color: 'var(--primary-gold)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Printer size={22} style={{ color: 'var(--primary-gold)' }} />
                  Configuração da Impressora Térmica Bluetooth Bluetooth 🖨️
                </h3>
                <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.4' }}>
                  Configure e teste a sua impressora térmica local para a impressão dos pedidos. Você pode imprimir o cupom e grampeá-lo na embalagem do cliente para rápida identificação na cozinha e na entrega.
                </p>
              </div>

              {printError && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid #ef4444', color: '#f87171', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                  ⚠️ {printError}
                </div>
              )}

              {printSuccess && (
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', borderLeft: '4px solid #10b981', color: '#34d399', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                  ✅ Ação executada com sucesso na impressora!
                </div>
              )}

              <div className="responsive-grid-2" style={{ gap: '1.5rem' }}>
                
                {/* Métodos de Impressão e Tamanho */}
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '16px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                  <h4 style={{ margin: 0, color: '#fff', fontSize: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>Preferências de Impressão</h4>
                  
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 600 }}>MÉTODO DE IMPRESSÃO</label>
                    <select
                      value={printerSettings.method}
                      onChange={(e) => handleSavePrinterSettings({ ...printerSettings, method: e.target.value as 'browser' | 'bluetooth' | 'serial' })}
                      style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', background: '#0b0f19', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer', fontSize: '0.9rem' }}
                    >
                      <option value="browser">Navegador (Padrão do Sistema) - Recomendado p/ Cabo USB</option>
                      <option value="bluetooth">Bluetooth Direto (Web Bluetooth BLE API)</option>
                      <option value="serial">Cabo USB Direto (Web Serial API) - Chrome/Edge</option>
                    </select>
                    <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.3' }}>
                      {printerSettings.method === 'browser' && 'Utiliza o gerenciador de impressão do próprio sistema (Windows/Android/iOS). Altamente compatível com qualquer impressora pareada por Bluetooth clássico ou conectada por cabo USB.'}
                      {printerSettings.method === 'bluetooth' && 'Envia dados binários brutos (ESC/POS) diretamente à impressora via Bluetooth BLE do navegador. Não abre telas do sistema.'}
                      {printerSettings.method === 'serial' && 'Envia dados binários brutos (ESC/POS) diretamente à impressora USB conectada por cabo serial virtual COM. Não abre telas do sistema.'}
                    </p>
                  </div>

                  {printerSettings.method === 'serial' && (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 600 }}>TAXA DE TRANSMISSÃO (BAUD RATE)</label>
                      <select
                        value={printerSettings.baudRate || 9600}
                        onChange={(e) => handleSavePrinterSettings({ ...printerSettings, baudRate: parseInt(e.target.value) })}
                        style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', background: '#0b0f19', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer', fontSize: '0.9rem' }}
                      >
                        <option value={9600}>9600 bps (Padrão)</option>
                        <option value={19200}>19200 bps</option>
                        <option value={38400}>38400 bps</option>
                        <option value={57600}>57600 bps</option>
                        <option value={115200}>115200 bps</option>
                      </select>
                    </div>
                  )}

                  <div className="responsive-grid-2">
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 600 }}>TAMANHO DA BOBINA</label>
                      <select
                        value={printerSettings.paperSize}
                        onChange={(e) => handleSavePrinterSettings({ ...printerSettings, paperSize: e.target.value as '58mm' | '80mm' })}
                        style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', background: '#0b0f19', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer', fontSize: '0.9rem' }}
                      >
                        <option value="58mm">58mm (Padrão Pequena)</option>
                        <option value="80mm">80mm (Grande/Larga)</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', fontWeight: 600 }}>Nº DE CÓPIAS</label>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={printerSettings.copies}
                        onChange={(e) => handleSavePrinterSettings({ ...printerSettings, copies: Math.max(1, parseInt(e.target.value) || 1) })}
                        style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '10px', background: '#0b0f19', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.9rem' }}
                      />
                    </div>
                  </div>
                </div>

                {/* Status de Conexão de Hardware */}
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '16px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                  <h4 style={{ margin: 0, color: '#fff', fontSize: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>Conexão de Hardware</h4>
                  
                  {printerSettings.method === 'bluetooth' && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(0,0,0,0.15)', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.03)' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: isBtConnected ? '#10b981' : '#ef4444', display: 'inline-block' }}></span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>
                          {isBtConnected ? `Conectado: ${btDeviceName}` : 'Impressora Bluetooth Desconectada'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem' }}>
                        {!isBtConnected ? (
                          <button
                            type="button"
                            disabled={isPairing}
                            onClick={handleConnectBt}
                            style={{ flex: 1, padding: '0.75rem', background: 'var(--primary-gold)', color: '#0b0f19', border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                          >
                            {isPairing ? <span className="spinner" style={{ width: '14px', height: '14px', border: '2px solid #0b0f19', borderTopColor: 'transparent' }} /> : <Printer size={16} />}
                            Parear / Conectar Impressora
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleDisconnectBt}
                            style={{ flex: 1, padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '10px', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer' }}
                          >
                            Desconectar Bluetooth
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {printerSettings.method === 'serial' && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(0,0,0,0.15)', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.03)' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: isSerialConn ? '#10b981' : '#ef4444', display: 'inline-block' }}></span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>
                          {isSerialConn ? `Conectado via USB: ${serialDeviceName}` : 'Impressora USB/Cabo Desconectada'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem' }}>
                        {!isSerialConn ? (
                          <button
                            type="button"
                            disabled={isSerialPairing}
                            onClick={handleConnectSerial}
                            style={{ flex: 1, padding: '0.75rem', background: 'var(--primary-gold)', color: '#0b0f19', border: 'none', borderRadius: '10px', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                          >
                            {isSerialPairing ? <span className="spinner" style={{ width: '14px', height: '14px', border: '2px solid #0b0f19', borderTopColor: 'transparent' }} /> : <Printer size={16} />}
                            Conectar Impressora USB (Cabo)
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleDisconnectSerial}
                            style={{ flex: 1, padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '10px', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer' }}
                          >
                            Desconectar USB
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {printerSettings.method === 'browser' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                        Como você está usando o método **Navegador (Padrão do Sistema)**, a conexão direta não é necessária. O sistema utilizará o driver e as impressoras instaladas no seu sistema operacional (perfeito para cabos USB comuns).
                      </p>
                      
                      <div style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px dashed rgba(245, 158, 11, 0.25)', borderRadius: '10px', padding: '1rem', marginTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--primary-gold)', display: 'block', marginBottom: '0.3rem' }}>
                          ⚡ DICA: IMPRESSÃO DIRETA/SILENCIOSA
                        </span>
                        <span style={{ fontSize: '0.78rem', color: '#cbd5e1', display: 'block', lineHeight: '1.3', marginBottom: '0.6rem' }}>
                          Para imprimir direto sem abrir a janela de confirmação de impressão do navegador, adicione o parâmetro abaixo no final do campo <strong>Destino</strong> nas propriedades do atalho do Chrome:
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#0b0f19', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '0.5rem 0.75rem', justifyContent: 'space-between' }}>
                          <code style={{ fontSize: '0.85rem', color: '#10b981', fontFamily: 'monospace', fontWeight: 600 }}>--kiosk-printing</code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText('--kiosk-printing');
                              alert('Parâmetro copiado para a área de transferência!');
                            }}
                            style={{ padding: '0.3rem 0.6rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }}
                            onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                            onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                          >
                            Copiar
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    <button
                      type="button"
                      onClick={handleTestPrint}
                      style={{ padding: '0.75rem', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--primary-gold)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '10px', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                    >
                      <Printer size={16} />
                      Imprimir Cupom de Teste 🖨️
                    </button>
                  </div>
                </div>

              </div>

              {/* Automações de Impressão */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '16px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                <h4 style={{ margin: 0, color: '#fff', fontSize: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>Impressão Automática (Automação de Pedidos)</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.25rem' }}>
                  
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer', background: 'rgba(0,0,0,0.1)', padding: '0.85rem 1rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.02)' }}>
                    <input
                      type="checkbox"
                      checked={printerSettings.autoPrintOnNew}
                      onChange={(e) => handleSavePrinterSettings({ ...printerSettings, autoPrintOnNew: e.target.checked })}
                      style={{ marginTop: '0.2rem', accentColor: 'var(--primary-gold)' }}
                    />
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.9rem', color: '#fff' }}>Ao receber novo pedido</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Imprime o cupom automaticamente assim que o cliente enviar o pedido no caixa ou cardápio.</span>
                    </div>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer', background: 'rgba(0,0,0,0.1)', padding: '0.85rem 1rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.02)' }}>
                    <input
                      type="checkbox"
                      checked={printerSettings.autoPrintOnAccept}
                      onChange={(e) => handleSavePrinterSettings({ ...printerSettings, autoPrintOnAccept: e.target.checked })}
                      style={{ marginTop: '0.2rem', accentColor: 'var(--primary-gold)' }}
                    />
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.9rem', color: '#fff' }}>Ao começar preparo</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Imprime o cupom automaticamente na cozinha quando o cozinheiro clicar em 'Começar Preparo'.</span>
                    </div>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer', background: 'rgba(0,0,0,0.1)', padding: '0.85rem 1rem', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.02)' }}>
                    <input
                      type="checkbox"
                      checked={printerSettings.autoPrintOnReady}
                      onChange={(e) => handleSavePrinterSettings({ ...printerSettings, autoPrintOnReady: e.target.checked })}
                      style={{ marginTop: '0.2rem', accentColor: 'var(--primary-gold)' }}
                    />
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.9rem', color: '#fff' }}>Ao concluir preparo</strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Imprime o cupom automaticamente assim que o pedido for enviado para o balcão.</span>
                    </div>
                  </label>

                </div>
              </div>

            </div>
          )}

        
          {/* Aba 9: Impressora Bematech Elgin i8 */}
          {activeTab === 'elgin_i8' && (isAdmin || role === 'staff') && (
            <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%' }}>
              <div>
                <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0, color: 'var(--primary-gold)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Printer size={22} style={{ color: 'var(--primary-gold)' }} />
                  Impressora Bematech Elgin i8 (Térmica Não Fiscal)
                </h3>
                <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.4' }}>
                  A Elgin i8 é uma impressora térmica robusta com tripla interface e alta velocidade (250mm/s). Utilize esta seção para configurar os parâmetros específicos de comunicação e corte para emissão de comandas, NFC-e e recibos.
                </p>
              </div>

              {printError && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid #ef4444', color: '#f87171', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                  ⚠️ {printError}
                </div>
              )}

              {printSuccess && (
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', borderLeft: '4px solid #10b981', color: '#34d399', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                  ✅ Ação executada com sucesso na Elgin i8!
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h4 style={{ margin: '0 0 1rem 0', color: '#fff', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Settings size={18} style={{ color: 'var(--text-secondary)' }} />
                    Tripla Interface de Comunicação
                  </h4>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.85rem' }}>Modo de Conexão (Elgin i8)</label>
                      <select
                        value={printerSettings.method}
                        onChange={(e) => handleSavePrinterSettings({ ...printerSettings, method: e.target.value as 'browser' | 'bluetooth' | 'serial' | 'ethernet' })}
                        style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer', fontSize: '0.9rem' }}
                      >
                        <option value="browser">USB / Spooler do Windows (Padrão)</option>
                        <option value="ethernet">Rede Local (Ethernet / IP Direto)</option>
                        <option value="serial">Cabo Serial / COM Direta</option>
                      </select>
                    </div>

                    {printerSettings.method === 'ethernet' && (
                      <div className="fade-in">
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.85rem' }}>Endereço IP da Elgin i8</label>
                        <input
                          type="text"
                          placeholder="Ex: 192.168.1.100"
                          style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '0.9rem' }}
                        />
                      </div>
                    )}
                    
                    {printerSettings.method === 'serial' && (
                      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: isSerialConn ? '#10b981' : '#ef4444', display: 'inline-block' }}></span>
                          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>
                            {isSerialConn ? 'Serial COM Conectada: ' + serialDeviceName : 'Porta Serial Fechada'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          {!isSerialConn ? (
                            <button
                              type="button"
                              onClick={handleConnectSerial}
                              disabled={isSerialPairing}
                              className="primary-button"
                              style={{ flex: 1, padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                            >
                              {isSerialPairing ? <span className="spinner" style={{ width: '14px', height: '14px', border: '2px solid #0b0f19', borderTopColor: 'transparent' }} /> : <Printer size={16} />}
                              Abrir Porta COM
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handleDisconnectSerial}
                              style={{ flex: 1, padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '12px', fontWeight: 600 }}
                            >
                              <X size={16} />
                              Desconectar
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h4 style={{ margin: '0 0 1rem 0', color: '#fff', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ClipboardList size={18} style={{ color: 'var(--text-secondary)' }} />
                    Hardware & Impressão (80mm)
                  </h4>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.85rem' }}>Guilhotina Integrada</label>
                      <select
                        style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '12px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer', fontSize: '0.9rem' }}
                      >
                        <option value="auto">Corte Automático (Padrão de Fábrica)</option>
                        <option value="manual">Corte Manual</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.85rem' }}>Largura do Papel</label>
                        <input
                          type="text"
                          readOnly
                          value="80mm (Bobina Padrão)"
                          style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', color: '#94a3b8', fontSize: '0.9rem', cursor: 'not-allowed' }}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.85rem' }}>Velocidade Max.</label>
                        <input
                          type="text"
                          readOnly
                          value="250 mm/s"
                          style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', color: '#94a3b8', fontSize: '0.9rem', cursor: 'not-allowed' }}
                        />
                      </div>
                    </div>

                    <div style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px dashed rgba(245, 158, 11, 0.25)', borderRadius: '10px', padding: '1rem', marginTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--primary-gold)', display: 'block', marginBottom: '0.3rem' }}>
                          💡 IMPRESSÃO DIRETA WINDOWS (MODO USB)
                        </span>
                        <span style={{ fontSize: '0.78rem', color: '#cbd5e1', display: 'block', lineHeight: '1.3', marginBottom: '0.6rem' }}>
                          Para emitir cupons diretamente via USB sem pop-up no Windows, use o modo silencioso do Chrome adicionando ao atalho:
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#0b0f19', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '0.5rem 0.75rem', justifyContent: 'space-between' }}>
                          <code style={{ fontSize: '0.85rem', color: '#10b981', fontFamily: 'monospace', fontWeight: 600 }}>--kiosk-printing</code>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText('--kiosk-printing')}
                            style={{ padding: '0.3rem 0.6rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer' }}
                          >
                            Copiar
                          </button>
                        </div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem', marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    <button
                      type="button"
                      onClick={handleTestPrint}
                      style={{ padding: '0.75rem', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--primary-gold)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '10px', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                    >
                      <Printer size={16} />
                      Emitir Cupom Elgin i8 (80mm) 🖨️
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
};

export default SettingsPage;
