import { useEffect, useState, useRef } from 'react';
import { doc, onSnapshot, setDoc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../hooks/useAuth';
import { Send, Bot, User, Mic, Image, MapPin, Trash2 } from 'lucide-react';

interface Message {
  sender: 'client' | 'assistant' | 'operator';
  text: string;
  timestamp: string;
  type?: 'text' | 'image' | 'audio' | 'location';
  mediaUrl?: string;
  location?: {
    latitude: number;
    longitude: number;
    isRealTime?: boolean;
  };
}

interface ChatSession {
  clientUid: string;
  clientName: string;
  messages: Message[];
  assistantActive: boolean;
  lastMessageAt: string;
  unreadByOperator?: boolean;
}

interface ClientSupportChatProps {
  isFloating?: boolean;
  onClose?: () => void;
}

export const ClientSupportChat = ({ isFloating = false, onClose }: ClientSupportChatProps) => {
  const { user, userData } = useAuth();

  const getVisitorId = () => {
    let id = sessionStorage.getItem('donalu_visitor_id');
    if (!id) {
      id = Math.random().toString(36).substring(2, 11);
      sessionStorage.setItem('donalu_visitor_id', id);
    }
    return id;
  };

  const clientUid = user?.uid || 'visitante_' + getVisitorId();
  const clientName = user?.displayName || userData?.name || 'Cliente Visitante';

  const [chat, setChat] = useState<ChatSession | null>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [aiResponding, setAiResponding] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Media attachments states
  const [showLocationMenu, setShowLocationMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isSharingRealTime, setIsSharingRealTime] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const watchPositionIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (watchPositionIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchPositionIdRef.current);
      }
    };
  }, []);

  const sendMediaMessage = async (type: 'image' | 'audio' | 'location', mediaUrl: string, textFallback: string, locationObj?: any) => {
    setSending(true);
    try {
      const docRef = doc(db, 'support_chats', clientUid);
      const currentMessages = chat?.messages || [];

      const newMsg: Message = {
        sender: 'client',
        text: textFallback,
        timestamp: new Date().toISOString(),
        type,
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(locationObj ? { location: locationObj } : {})
      };

      const updatedMessages = [...currentMessages, newMsg];

      await setDoc(docRef, {
        clientUid,
        clientName,
        messages: updatedMessages,
        assistantActive: chat ? chat.assistantActive : true,
        lastMessageAt: new Date().toISOString(),
        unreadByOperator: true
      });

      if (chat ? chat.assistantActive : true) {
        triggerAiResponse(updatedMessages, textFallback);
      }
    } catch (err) {
      console.error('Erro ao enviar mensagem de mídia:', err);
    } finally {
      setSending(false);
    }
  };

  const handlePhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64Image = reader.result as string;
      await sendMediaMessage('image', base64Image, 'Imagem enviada 📷');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const options = { mimeType: 'audio/webm' };
      let recorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch (_) {
        recorder = new MediaRecorder(stream);
      }
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((t) => t + 1);
      }, 1000);
    } catch (err) {
      console.error('Erro ao acessar microfone:', err);
      alert('Não foi possível acessar o microfone para gravação de áudio.');
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
    clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingTime(0);
    audioChunksRef.current = [];
  };

  const stopAndSendRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;
        await sendMediaMessage('audio', base64Audio, 'Áudio enviado 🎤');
      };
      reader.readAsDataURL(audioBlob);
    };

    mediaRecorderRef.current.stop();
    clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingTime(0);
  };

  const sendFixedLocation = () => {
    setShowLocationMenu(false);
    if (!navigator.geolocation) {
      alert('Geolocalização não é suportada pelo seu navegador.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        await sendMediaMessage('location', '', 'Localização fixa enviada 📍', {
          latitude,
          longitude,
          isRealTime: false
        });
      },
      (error) => {
        console.error('Erro ao obter geolocalização:', error);
        alert('Não foi possível obter a sua localização atual.');
      }
    );
  };

  const toggleRealTimeLocation = () => {
    setShowLocationMenu(false);
    if (isSharingRealTime) {
      if (watchPositionIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchPositionIdRef.current);
        watchPositionIdRef.current = null;
      }
      setIsSharingRealTime(false);
      return;
    }

    if (!navigator.geolocation) {
      alert('Geolocalização não é suportada pelo seu navegador.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setIsSharingRealTime(true);

        const docRef = doc(db, 'support_chats', clientUid);
        const currentMessages = chat?.messages || [];

        const newMsg: Message = {
          sender: 'client',
          text: 'Compartilhando localização em tempo real... 📡',
          timestamp: new Date().toISOString(),
          type: 'location',
          location: {
            latitude,
            longitude,
            isRealTime: true
          }
        };

        const updatedMessages = [...currentMessages, newMsg];
        await setDoc(docRef, {
          clientUid,
          clientName,
          messages: updatedMessages,
          assistantActive: chat ? chat.assistantActive : true,
          lastMessageAt: new Date().toISOString(),
          unreadByOperator: true
        });

        if (chat ? chat.assistantActive : true) {
          triggerAiResponse(updatedMessages, 'Localização em tempo real enviada 📡');
        }

        const watchId = navigator.geolocation.watchPosition(
          async (pos) => {
            const newLat = pos.coords.latitude;
            const newLng = pos.coords.longitude;

            const freshDoc = await getDoc(docRef);
            if (freshDoc.exists()) {
              const freshData = freshDoc.data() as ChatSession;
              const freshMsgs = [...freshData.messages];
              
              const targetIdx = freshMsgs.map((m, idx) => ({ m, idx })).reverse().find(x => x.m.type === 'location' && x.m.location?.isRealTime === true)?.idx;
              
              if (targetIdx !== undefined && targetIdx >= 0) {
                freshMsgs[targetIdx] = {
                  ...freshMsgs[targetIdx],
                  location: {
                    latitude: newLat,
                    longitude: newLng,
                    isRealTime: true
                  }
                };

                await setDoc(docRef, {
                  ...freshData,
                  messages: freshMsgs
                });
              }
            }
          },
          (err) => console.error('Erro no watchPosition:', err),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );

        watchPositionIdRef.current = watchId;
      },
      (error) => {
        console.error('Erro ao obter geolocalização:', error);
        alert('Não foi possível obter a sua localização atual.');
      }
    );
  };

  // 1. Listen to client chat in Firestore
  useEffect(() => {
    const docRef = doc(db, 'support_chats', clientUid);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setChat(docSnap.data() as ChatSession);
      } else {
        setChat({
          clientUid,
          clientName,
          messages: [
            {
              sender: 'assistant',
              text: 'Oi! Tudo bem? Como posso te ajudar? Vai um pastelzinho hoje? 🥟😋',
              timestamp: new Date().toISOString()
            }
          ],
          assistantActive: true,
          lastMessageAt: new Date().toISOString()
        });
      }
    }, (err) => {
      console.error('Erro ao escutar chat de suporte:', err);
    });

    return () => unsubscribe();
  }, [clientUid, clientName]);

  // 2. Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages]);

  // 3. AI response trigger
  const triggerAiResponse = async (chatHistory: Message[], newClientMessage: string) => {
    setAiResponding(true);
    try {
      // Helper normalization function
      const normalizeText = (text: string) => {
        return text
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^\w\s]/gi, '')
          .trim();
      };

      // Failsafe: parses instructional training rules into friendly conversational responses
      const parseInstructionalResponse = (instruction: string, clientMsg: string): string => {
        const instLower = instruction.toLowerCase().trim();
        const msgLower = clientMsg.toLowerCase().trim();

        // 1. Detect greeting instructions
        if (instLower.includes('bom dia') || instLower.includes('boa tarde') || instLower.includes('boa noite') || instLower.includes('retribua') || instLower.includes('cumprimente')) {
          if (msgLower.includes('boa noite')) return 'Boa noite! Tudo bem? 🥟😋 Como posso te ajudar?';
          if (msgLower.includes('boa tarde')) return 'Boa tarde! Tudo bem? 🥟😋 Como posso te ajudar?';
          if (msgLower.includes('bom dia')) return 'Bom dia! Tudo bem? 🥟😋 Como posso te ajudar?';
          if (msgLower.includes('oi') || msgLower.includes('ola') || msgLower.includes('olá') || msgLower.includes('tudo bem')) {
            return 'Oi! Tudo bem? Vai um pastelzinho hoje? 🥟😋 Como posso te ajudar?';
          }
        }

        // 2. Strip prefix instructions
        const prefixes = [
          /^(diga|fale|responda|informe|explique|avise)\s+que\s+/i,
          /^(diga|fale|responda|informe|explique|avise)\s+para\s+o\s+cliente\s+que\s+/i,
          /^(diga|fale|responda|informe|explique|avise)\s+ao\s+cliente\s+que\s+/i,
          /^(diga|fale|responda|informe|explique|avise)\s+/i,
          /^retribua\s+/i,
          /^caso\s+o\s+cliente\s+.*,\s*(responda|diga|fale|retribua)\s+/i
        ];

        let cleaned = instruction;
        for (const pattern of prefixes) {
          if (pattern.test(cleaned)) {
            cleaned = cleaned.replace(pattern, '');
            cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
            break;
          }
        }

        if (cleaned !== instruction) {
          return cleaned;
        }

        // 3. Structural rule fallback
        if (instLower.startsWith('caso o cliente') || instLower.startsWith('se o cliente') || instLower.includes('instrua') || instLower.includes('atendente deve')) {
          return 'Olá! Tudo bem? 🥟 Como posso te ajudar hoje? Se quiser ver os sabores e preços, acesse o Cardápio Digital no menu lateral!';
        }

        return instruction;
      };

      // Fetch custom rules from Firestore
      const rulesSnap = await getDocs(collection(db, 'ai_rules'));
      const rulesList: any[] = [];
      rulesSnap.forEach(d => rulesList.push(d.data()));

      // Try to find a direct match
      const normalizedInput = normalizeText(newClientMessage);
      let matchedRule = null;
      for (const rule of rulesList) {
        const normalizedPattern = normalizeText(rule.pattern || '');
        if (normalizedPattern && (normalizedInput.includes(normalizedPattern) || normalizedPattern.includes(normalizedInput))) {
          matchedRule = rule;
          break;
        }
      }

      // Load AI config
      const configRef = doc(db, 'settings', 'ai_assistant_config');
      const configSnap = await getDoc(configRef);
      const aiConfig = configSnap.exists() ? configSnap.data() : {
        assistantName: 'Dona Lu Assistente',
        aiInstructions: 'Seja um assistente virtual atencioso e simpático para a Dona Lu Pastelaria.',
        aiRestrictions: 'Não dê descontos sem aprovação, não fale sobre concorrentes.',
        geminiApiKey: ''
      };

      // Load products
      const productsSnap = await getDocs(collection(db, 'products'));
      const productsList: any[] = [];
      productsSnap.forEach(d => productsList.push(d.data()));
      const availableItems = productsList.filter(p => p.stock === undefined || Number(p.stock) > 0);
      const outOfStockItems = productsList.filter(p => p.stock !== undefined && Number(p.stock) <= 0);

      // Load recent orders for logged-in client
      let recentOrdersStr = 'Nenhum pedido recente encontrado.';
      if (user?.uid) {
        try {
          const ordersRef = collection(db, 'orders');
          const q = query(ordersRef, where('clientUid', '==', user.uid));
          const ordersSnap = await getDocs(q);
          const clientOrders: any[] = [];
          ordersSnap.forEach(d => clientOrders.push(d.data()));
          clientOrders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          if (clientOrders.length > 0) {
            const lastOrder = clientOrders[0];
            const statusLabels: Record<string, string> = {
              pending: 'Aguardando aprovação do caixa',
              preparing: 'Sendo preparado na cozinha',
              ready: 'Pronto para entrega ou retirada',
              delivering: 'Em trânsito com o entregador',
              completed: 'Entregue / Concluído',
              cancelled: 'Cancelado',
              awaiting_payment: 'Aguardando confirmação do pagamento'
            };
            const itemsStr = lastOrder.items?.map((i: any) => `${i.quantity}x ${i.name}`).join(', ') || '';
            recentOrdersStr = `Pedido mais recente:\n- Status: ${statusLabels[lastOrder.status] || lastOrder.status}\n- Itens: ${itemsStr}\n- Total: R$ ${lastOrder.total?.toFixed(2).replace('.', ',')}`;
          }
        } catch (_) {
          // ignore orders fetch error
        }
      }

      let replyText = '';

      // Try Gemini API if key exists and no direct rule matched
      if (aiConfig.geminiApiKey && aiConfig.geminiApiKey.trim() !== '') {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${aiConfig.geminiApiKey}`;

          // Inject custom rules into system prompt for Gemini to guide it
          const customRulesPrompt = rulesList.length > 0 
            ? `\nDIRETRIZES E INSTRUÇÕES ENSINADAS (Siga estas diretrizes de forma estrita e inteligente, executando as instruções na resposta em vez de repeti-las para o cliente):\n${rulesList.map(r => `- Diretriz para "${r.pattern}": ${r.response}`).join('\n')}` 
            : '';

          const systemPrompt = `Você é "${aiConfig.assistantName || 'Dona Lu Assistente'}", atendente virtual da Dona Lu Pastelaria.
Instruções: ${aiConfig.aiInstructions}
Restrições: ${aiConfig.aiRestrictions}${customRulesPrompt}

ESTABELECIMENTO:
- Rua Jícara, 239 - Campo Grande, RJ | Tel: (21) 3439-5241
- Horário: Terça a domingo, 18h às 23h30

PRODUTOS DISPONÍVEIS:
${availableItems.map(p => `- ${p.name} (R$ ${p.price?.toFixed(2)})`).join('\n')}

${outOfStockItems.length > 0 ? `ESGOTADOS: ${outOfStockItems.map(p => p.name).join(', ')}` : ''}

PEDIDO DO CLIENTE: ${recentOrdersStr}

Responda de forma extremamente curta e natural, como um atendente humano no WhatsApp. Não se apresente como robô ou I.A. Use emojis com moderação. Máximo 2 frases.`;

          const formattedHistory = chatHistory.slice(-4).map(m => `${m.sender === 'client' ? 'Cliente' : 'Atendente'}: ${m.text}`).join('\n');
          const prompt = `${systemPrompt}\n\nConversa:\n${formattedHistory}\n\nCliente: "${newClientMessage}"\n\nResponda:`;

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            signal: controller.signal
          });

          clearTimeout(timeout);

          if (response.ok) {
            const resJson = await response.json();
            replyText = resJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          } else {
            console.warn('Gemini API retornou erro, usando fallback local.');
          }
        } catch (geminiError) {
          console.warn('Gemini API falhou (rede/timeout/CORS), usando fallback local:', geminiError);
        }
      }

      // Local rules engine fallback
      if (!replyText) {
        if (matchedRule) {
          replyText = parseInstructionalResponse(matchedRule.response, newClientMessage);
        } else {
          const msg = newClientMessage.toLowerCase();
          
          if (msg.includes('pedido') || msg.includes('status') || msg.includes('onde') || msg.includes('rastreio')) {
            replyText = recentOrdersStr === 'Nenhum pedido recente encontrado.'
              ? 'Não encontrei pedidos recentes na sua conta. Fez o pedido por aqui? 🤔'
              : `Olha aqui:\n${recentOrdersStr}`;
          } else if (msg.includes('indica') || msg.includes('recomenda') || msg.includes('sugere') || msg.includes('sugestao') || msg.includes('sugestão') || msg.includes('melhor') || msg.includes('mais vendido') || msg.includes('dica')) {
            const names = availableItems.slice(0, 3).map(p => p.name).join(', ');
            replyText = names 
              ? `Recomendo experimentar nossos deliciosos sabores: ${names}! São os mais pedidos por aqui. 😋 Se quiser ver mais detalhes, confira no Cardápio Digital.`
              : 'Recomendo experimentar nosso tradicional Pastel de Carne com queijo ou nosso campeão de vendas! 😋 Dê uma olhada em todos os sabores no Cardápio Digital.';
          } else if (msg.includes('cardapio') || msg.includes('cardápio') || msg.includes('sabores') || msg.includes('tem de que') || msg.includes('sabor') || msg.includes('recheio')) {
            const names = availableItems.slice(0, 5).map(p => p.name).join(', ');
            replyText = `Temos ${names || 'pastéis variados'} e muito mais! 😋 Você pode ver todo o cardápio e fazer seu pedido no Cardápio Digital no menu lateral.`;
          } else if (msg.includes('preco') || msg.includes('preço') || msg.includes('valor') || msg.includes('valores') || msg.includes('quanto custa') || msg.includes('custa') || msg.includes('quanto e') || msg.includes('quanto é')) {
            const minPrice = availableItems.reduce((min, p) => p.price < min ? p.price : min, availableItems[0]?.price || 10.00);
            replyText = `Temos pastéis deliciosos a partir de R$ ${minPrice.toFixed(2).replace('.', ',')}! 💵 Confira os valores exatos de cada sabor no Cardápio Digital.`;
          } else if (msg.includes('pagamento') || msg.includes('pagar') || msg.includes('cartao') || msg.includes('cartão') || msg.includes('pix') || msg.includes('dinheiro') || msg.includes('maquininha') || msg.includes('maquina')) {
            replyText = 'Aceitamos PIX, cartão de crédito/débito online (pelo site) e também levamos a maquininha física ou recebemos em dinheiro na entrega! 💳';
          } else if (msg.includes('esgotado') || msg.includes('acabou') || msg.includes('indisponivel') || msg.includes('tem estoque') || msg.includes('tem ainda')) {
            replyText = outOfStockItems.length > 0
              ? `No momento só falta ${outOfStockItems.map(p => p.name).join(', ')}. O restante está saindo fresquinho! 😉`
              : 'Tudo disponível! Pode pedir sem medo no Cardápio Digital. 🥟';
          } else if (msg.includes('horario') || msg.includes('horário') || msg.includes('abre') || msg.includes('fecha') || msg.includes('funcionamento') || msg.includes('aberto')) {
            replyText = 'Abrimos de terça a domingo, das 18h às 23h30! Fora desse horário, você pode conferir o cardápio mas a loja estará fechada para pedidos. 🕕';
          } else if (msg.includes('endereco') || msg.includes('endereço') || msg.includes('onde fica') || msg.includes('localizacao') || msg.includes('localização') || msg.includes('campo grande')) {
            replyText = 'Ficamos na Rua Jícara, 239 - Campo Grande, RJ. Venha nos visitar ou faça seu pedido por aqui para entrega! 📍';
          } else if (msg.includes('entrega') || msg.includes('delivery') || msg.includes('taxa') || msg.includes('frete')) {
            replyText = 'Entregamos sim! 🛵 Informe seu endereço no Cardápio Digital para ver o valor da taxa de entrega e o tempo estimado para o seu bairro.';
          } else if (msg.includes('obrigado') || msg.includes('obrigada') || msg.includes('valeu') || msg.includes('show') || msg.includes('obg') || msg.includes('tchau') || msg.includes('grato')) {
            replyText = 'De nada! Estou aqui para ajudar. Se quiser pedir, é só acessar o Cardápio Digital. Bom apetite! 🥟😊';
          } else if (msg.includes('oi') || msg.includes('olá') || msg.includes('ola') || msg.includes('bom dia') || msg.includes('boa tarde') || msg.includes('boa noite') || msg.includes('tudo bem')) {
            replyText = 'Oi! Tudo bem? Vai um pastelzinho hoje? 🥟😋 Como posso te ajudar?';
          } else {
            replyText = 'Hum, não entendi muito bem sua dúvida. 😅 Se você quiser ver nossos pastéis e fazer seu pedido, acesse o Cardápio Digital! Mas se precisar de outra coisa, pode mandar aqui.';
          }
        }
      }

      // Clean up response if it contains raw instruction/directive text (failsafe)
      replyText = parseInstructionalResponse(replyText, newClientMessage);

      // Save AI reply to Firestore
      const docRef = doc(db, 'support_chats', clientUid);
      const updatedMessages = [
        ...chatHistory,
        {
          sender: 'assistant' as const,
          text: replyText,
          timestamp: new Date().toISOString()
        }
      ];

      await setDoc(docRef, {
        clientUid,
        clientName,
        messages: updatedMessages,
        assistantActive: true,
        lastMessageAt: new Date().toISOString(),
        unreadByOperator: true
      });

    } catch (err) {
      console.error('Erro ao gerar resposta da I.A.:', err);
    } finally {
      setAiResponding(false);
    }
  };

  // 4. Send client message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || sending) return;

    setSending(true);
    const newMsgText = inputText.trim();
    setInputText('');

    try {
      const docRef = doc(db, 'support_chats', clientUid);
      const currentMessages = chat?.messages || [];
      const clientMessage: Message = {
        sender: 'client',
        text: newMsgText,
        timestamp: new Date().toISOString()
      };
      const updatedMessages = [...currentMessages, clientMessage];
      const isAssistantActive = chat ? chat.assistantActive : true;

      await setDoc(docRef, {
        clientUid,
        clientName,
        messages: updatedMessages,
        assistantActive: isAssistantActive,
        lastMessageAt: new Date().toISOString(),
        unreadByOperator: true
      });

      if (isAssistantActive) {
        setTimeout(() => {
          triggerAiResponse(updatedMessages, newMsgText);
        }, 800);
      }
    } catch (err) {
      console.error('Erro ao enviar mensagem:', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: isFloating ? '400px' : 'calc(100vh - 200px)',
      minHeight: isFloating ? '380px' : '480px',
      background: 'var(--card-bg, #0f172a)',
      borderRadius: isFloating ? '16px' : '12px',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      overflow: 'hidden',
      boxShadow: isFloating ? '0 12px 30px rgba(0,0,0,0.5)' : 'none'
    }}>

      {/* Header */}
      <div style={{
        padding: '0.75rem 1rem',
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: chat?.assistantActive ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${chat?.assistantActive ? 'var(--primary-gold)' : '#10b981'}`
          }}>
            {chat?.assistantActive
              ? <Bot size={16} style={{ color: 'var(--primary-gold)' }} />
              : <User size={16} style={{ color: '#10b981' }} />}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fff' }}>
              {chat?.assistantActive ? 'Dona Lu Pastelaria 🥟' : 'Atendimento Humano 👨‍🍳'}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              {chat?.assistantActive ? 'Respostas rápidas' : 'Operador conectado'}
            </span>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.2rem', padding: '0.2rem' }}
          >
            ×
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        background: 'rgba(0,0,0,0.15)'
      }}>
        {chat?.messages.map((msg, index) => {
          const isClient = msg.sender === 'client';
          const isAI = msg.sender === 'assistant';
          return (
            <div
              key={index}
              style={{
                display: 'flex',
                justifyContent: isClient ? 'flex-end' : 'flex-start',
                width: '100%'
              }}
            >
              <div style={{
                maxWidth: '80%',
                padding: '0.65rem 0.85rem',
                borderRadius: isClient ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                background: isClient
                  ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                  : (isAI ? 'rgba(255, 255, 255, 0.05)' : 'rgba(16, 185, 129, 0.1)'),
                border: isClient
                  ? 'none'
                  : (isAI ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(16,185,129,0.2)'),
                color: isClient ? '#000' : '#fff',
                fontSize: '0.85rem',
                lineHeight: '1.4',
                textAlign: 'left',
                boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
              }}>
                <div style={{ fontSize: '0.65rem', color: isClient ? 'rgba(0,0,0,0.5)' : 'var(--text-secondary)', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {isClient ? <User size={10} /> : (isAI ? <Bot size={10} /> : <User size={10} />)}
                  {isClient ? 'Você' : (isAI ? 'Atendente' : 'Atendente Humano')}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', fontWeight: isClient ? 500 : 400 }}>
                  {msg.type === 'image' && msg.mediaUrl && (
                    <img 
                      src={msg.mediaUrl} 
                      alt="Imagem" 
                      style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '8px', display: 'block', margin: '0.35rem 0', cursor: 'pointer' }}
                      onClick={() => window.open(msg.mediaUrl)}
                    />
                  )}
                  {msg.type === 'audio' && msg.mediaUrl && (
                    <audio 
                      src={msg.mediaUrl} 
                      controls 
                      style={{ display: 'block', margin: '0.35rem 0', maxWidth: '100%' }} 
                    />
                  )}
                  {msg.type === 'location' && msg.location && (
                    <div style={{
                      background: 'rgba(0,0,0,0.2)',
                      padding: '0.5rem',
                      borderRadius: '8px',
                      marginTop: '0.35rem',
                      border: '1px solid rgba(255,255,255,0.1)'
                    }}>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', color: isClient ? '#000' : 'var(--primary-gold)' }}>
                        📍 {msg.location.isRealTime ? 'Localização em Tempo Real' : 'Localização Fixa'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: isClient ? 'rgba(0,0,0,0.7)' : 'var(--text-secondary)', margin: '0.2rem 0' }}>
                        Lat: {msg.location.latitude.toFixed(6)}, Lng: {msg.location.longitude.toFixed(6)}
                      </div>
                      {msg.location.isRealTime && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: isClient ? '#047857' : '#10b981', marginBottom: '0.35rem' }}>
                          <span className="pulse-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: isClient ? '#047857' : '#10b981', display: 'inline-block' }} />
                          Transmitindo em tempo real...
                        </div>
                      )}
                      <a 
                        href={`https://www.google.com/maps?q=${msg.location.latitude},${msg.location.longitude}`} 
                        target="_blank" 
                        rel="noreferrer"
                        style={{
                          display: 'inline-block',
                          background: isClient ? '#000' : 'var(--primary-gold)',
                          color: isClient ? 'var(--primary-gold)' : '#000',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          textDecoration: 'none',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          marginTop: '0.25rem',
                          textAlign: 'center'
                        }}
                      >
                        Abrir no Google Maps
                      </a>
                    </div>
                  )}
                  {msg.text}
                </div>
              </div>
            </div>
          );
        })}
        {aiResponding && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
            <div style={{
              padding: '0.5rem 0.85rem',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255,255,255,0.05)',
              color: 'var(--text-secondary)',
              fontSize: '0.78rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span className="spinner" style={{ width: '12px', height: '12px', borderWidth: '1.5px' }} />
              digitando...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Location sharing menu popup */}
      {showLocationMenu && (
        <div style={{
          position: 'absolute',
          bottom: '60px',
          left: '10px',
          background: '#1e293b',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '0.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
          zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          <button
            type="button"
            onClick={sendFixedLocation}
            style={{
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: '0.78rem',
              padding: '0.4rem 0.75rem',
              cursor: 'pointer',
              textAlign: 'left',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
          >
            📍 Enviar Localização Fixa
          </button>
          <button
            type="button"
            onClick={toggleRealTimeLocation}
            style={{
              background: 'none',
              border: 'none',
              color: isSharingRealTime ? '#ef4444' : '#fff',
              fontSize: '0.78rem',
              padding: '0.4rem 0.75rem',
              cursor: 'pointer',
              textAlign: 'left',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
          >
            📡 {isSharingRealTime ? 'Parar Real-time' : 'Compartilhar em Tempo Real'}
          </button>
        </div>
      )}

      {/* Hidden file input for photos */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handlePhotoSelected}
        accept="image/*"
        style={{ display: 'none' }}
      />

      {/* Input Form */}
      <form onSubmit={handleSendMessage} style={{
        padding: '0.75rem',
        background: '#0f172a',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
        position: 'relative'
      }}>
        {isRecording ? (
          // Recording UI mode
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: '0.5rem', background: 'rgba(239, 68, 68, 0.05)', padding: '0.45rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
            <span className="pulse-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            <span style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 600 }}>Gravando... {recordingTime}s</span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={cancelRecording}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <Trash2 size={16} />
            </button>
            <button
              type="button"
              onClick={stopAndSendRecording}
              style={{ background: 'var(--primary-gold)', border: 'none', color: '#000', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <Send size={12} />
            </button>
          </div>
        ) : (
          // Normal Input UI mode
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Mandar Foto"
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center' }}
            >
              <Image size={18} />
            </button>

            <button
              type="button"
              onClick={() => setShowLocationMenu(!showLocationMenu)}
              title="Mandar Localização"
              style={{ background: 'none', border: 'none', color: isSharingRealTime ? '#10b981' : 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center' }}
            >
              <MapPin size={18} />
            </button>

            <button
              type="button"
              onClick={startRecording}
              title="Gravar Áudio"
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center' }}
            >
              <Mic size={18} />
            </button>

            <input
              type="text"
              placeholder="Digite uma mensagem..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={sending}
              style={{
                flex: 1,
                padding: '0.55rem 0.75rem',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '0.85rem',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
            />
            <button
              type="submit"
              disabled={!inputText.trim() || sending}
              style={{
                background: inputText.trim() ? 'var(--primary-gold)' : 'rgba(255,255,255,0.05)',
                color: inputText.trim() ? '#000' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: '8px',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: inputText.trim() ? 'pointer' : 'default',
                transition: 'background 0.2s, color 0.2s'
              }}
            >
              <Send size={16} />
            </button>
          </>
        )}
      </form>
    </div>
  );
};
