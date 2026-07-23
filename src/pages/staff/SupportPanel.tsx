import { useEffect, useState, useRef } from 'react';
import { collection, query, onSnapshot, doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { MessageSquare, Bot, User, Send, Settings, Save, AlertCircle, Play, Pause, Check, Trash2, GraduationCap, ChevronLeft, Mic, Image, MapPin } from 'lucide-react';

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

interface AIConfig {
  assistantName: string;
  aiInstructions: string;
  aiRestrictions: string;
  geminiApiKey: string;
}

export const SupportPanel = () => {
  const [activeChats, setActiveChats] = useState<ChatSession[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [activeTab, setActiveTab] = useState<'chats' | 'treinamento'>('chats');
  
  // Detect mobile screen width dynamically
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Media attachments for Operator
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);

  const sendOperatorMediaMessage = async (type: 'image' | 'audio' | 'location', mediaUrl: string, textFallback: string, locationObj?: any) => {
    if (!selectedChatId || !selectedChat) return;
    try {
      const docRef = doc(db, 'support_chats', selectedChatId);
      const currentMessages = selectedChat.messages || [];

      const newMsg: Message = {
        sender: 'operator',
        text: textFallback,
        timestamp: new Date().toISOString(),
        type,
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(locationObj ? { location: locationObj } : {})
      };

      const updatedMessages = [...currentMessages, newMsg];

      await setDoc(docRef, {
        ...selectedChat,
        messages: updatedMessages,
        assistantActive: false, // Turn off AI since human operator is interacting!
        lastMessageAt: new Date().toISOString(),
        unreadByOperator: false
      });
    } catch (err) {
      console.error('Erro ao enviar mídia do operador:', err);
    }
  };

  const handleOperatorPhotoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64Image = reader.result as string;
      await sendOperatorMediaMessage('image', base64Image, 'Imagem enviada 📷');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const startOperatorRecording = async () => {
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
      alert('Não foi possível acessar o microfone para gravação.');
    }
  };

  const cancelOperatorRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
    clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingTime(0);
    audioChunksRef.current = [];
  };

  const stopAndSendOperatorRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;
        await sendOperatorMediaMessage('audio', base64Audio, 'Áudio enviado 🎤');
      };
      reader.readAsDataURL(audioBlob);
    };

    mediaRecorderRef.current.stop();
    clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingTime(0);
  };

  const sendOperatorLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocalização não suportada.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        await sendOperatorMediaMessage('location', '', 'Localização enviada 📍', {
          latitude,
          longitude,
          isRealTime: false
        });
      },
      (err) => {
        console.error('Erro geolocalização:', err);
        // Fallback: send shop location
        sendOperatorMediaMessage('location', '', 'Localização da Pastelaria enviada 📍', {
          latitude: -22.9068,
          longitude: -43.1729,
          isRealTime: false
        });
      }
    );
  };
  
  // Custom quick training rules states
  const [customRules, setCustomRules] = useState<any[]>([]);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [trainingPattern, setTrainingPattern] = useState('');
  const [trainingResponse, setTrainingResponse] = useState('');

  // Escuta regras de treinamento do Firestore
  useEffect(() => {
    const q = query(collection(db, 'ai_rules'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rulesList: any[] = [];
      snapshot.forEach((docSnap) => {
        rulesList.push({ id: docSnap.id, ...docSnap.data() });
      });
      rulesList.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setCustomRules(rulesList);
    }, (err) => {
      console.error("Erro ao carregar regras de treinamento:", err);
    });
    return () => unsubscribe();
  }, []);

  const startQuickTraining = (patternText: string) => {
    setTrainingPattern(patternText);
    setTrainingResponse('');
    setShowTrainingModal(true);
  };

  const handleSaveQuickRule = async () => {
    if (!trainingPattern.trim() || !trainingResponse.trim()) return;
    try {
      const ruleId = 'rule_' + Math.random().toString(36).substring(2, 11);
      const ruleRef = doc(db, 'ai_rules', ruleId);
      await setDoc(ruleRef, {
        pattern: trainingPattern.trim(),
        response: trainingResponse.trim(),
        createdAt: new Date().toISOString()
      });
      setShowTrainingModal(false);
    } catch (err) {
      console.error("Erro ao salvar regra:", err);
      alert("Erro ao salvar regra de treinamento.");
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!window.confirm("Deseja realmente excluir esta regra de treinamento?")) return;
    try {
      await deleteDoc(doc(db, 'ai_rules', ruleId));
    } catch (err) {
      console.error("Erro ao excluir regra:", err);
    }
  };
  
  // Training config state
  const [config, setConfig] = useState<AIConfig>({
    assistantName: 'Dona Lu Assistente',
    aiInstructions: 'Seja um assistente virtual atencioso e simpático para a Dona Lu Pastelaria. Ajude com o cardápio, sabores e andamento do pedido.',
    aiRestrictions: 'Não dê descontos sem aprovação, não fale sobre concorrentes.',
    geminiApiKey: ''
  });
  
  const [savingConfig, setSavingConfig] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 1. Listen to active chats sorted by last message time
  useEffect(() => {
    const q = query(collection(db, 'support_chats'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatsList: ChatSession[] = [];
      snapshot.forEach((docSnap) => {
        chatsList.push(docSnap.data() as ChatSession);
      });
      chatsList.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      setActiveChats(chatsList);
    }, (err) => {
      console.error("Erro ao escutar chats de suporte ativos:", err);
    });

    return () => unsubscribe();
  }, []);

  // 2. Load AI assistant config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const docRef = doc(db, 'settings', 'ai_assistant_config');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setConfig(docSnap.data() as AIConfig);
        }
      } catch (err) {
        console.error("Erro ao carregar configurações da I.A.:", err);
      }
    };
    loadConfig();
  }, [activeTab]);

  // Selected chat session object
  const selectedChat = activeChats.find(c => c.clientUid === selectedChatId);

  // Scroll active chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedChat?.messages]);

  // 3. Mark selected chat as read by operator
  useEffect(() => {
    if (selectedChatId && selectedChat?.unreadByOperator) {
      const docRef = doc(db, 'support_chats', selectedChatId);
      setDoc(docRef, { ...selectedChat, unreadByOperator: false }, { merge: true })
        .catch(err => console.error("Erro ao marcar chat como lido:", err));
    }
  }, [selectedChatId, selectedChat?.messages]);

  // 4. Save AI Config
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setSaveSuccess(false);
    try {
      const docRef = doc(db, 'settings', 'ai_assistant_config');
      await setDoc(docRef, config);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Erro ao salvar configurações da I.A.:", err);
      alert("Erro ao salvar configurações no Firestore.");
    } finally {
      setSavingConfig(false);
    }
  };

  // 5. Send message as human operator (intercedes)
  const handleSendOperatorMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedChatId || !selectedChat) return;

    const newMsgText = inputText;
    setInputText('');

    try {
      const docRef = doc(db, 'support_chats', selectedChatId);
      
      const newOperatorMessage: Message = {
        sender: 'operator',
        text: newMsgText,
        timestamp: new Date().toISOString()
      };

      // Se o operador mandar mensagem, nós pausamos a I.A. automaticamente para evitar ruído e conflito de respostas
      const updatedMessages = [...selectedChat.messages, newOperatorMessage];
      await setDoc(docRef, {
        ...selectedChat,
        messages: updatedMessages,
        assistantActive: false, // Pausa a I.A. automaticamente!
        lastMessageAt: new Date().toISOString(),
        unreadByOperator: false
      });

    } catch (err) {
      console.error("Erro ao enviar mensagem do operador:", err);
    }
  };

  // 6. Toggle AI chatbot active/inactive status manually
  const toggleAssistantState = async (chatSession: ChatSession) => {
    try {
      const docRef = doc(db, 'support_chats', chatSession.clientUid);
      await setDoc(docRef, {
        ...chatSession,
        assistantActive: !chatSession.assistantActive
      }, { merge: true });
    } catch (err) {
      console.error("Erro ao alternar estado da I.A.:", err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: 'calc(100vh - 160px)', padding: '0.2rem' }} className="animate-fade-in">
      <style>{`
        @keyframes blink-warning {
          0% { background-color: rgba(239, 68, 68, 0.03); border-color: rgba(239, 68, 68, 0.2); }
          50% { background-color: rgba(239, 68, 68, 0.25); border-color: #ef4444; }
          100% { background-color: rgba(239, 68, 68, 0.03); border-color: rgba(239, 68, 68, 0.2); }
        }
        .blink-alert-chat {
          animation: blink-warning 1.5s infinite ease-in-out !important;
          border: 1px solid rgba(239, 68, 68, 0.4) !important;
        }
      `}</style>
      
      {/* Header and tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MessageSquare size={24} style={{ color: 'var(--primary-gold)' }} />
            Central de Atendimento
          </h2>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Acompanhe as interações do atendente virtual com os clientes e assuma o controle quando necessário.
          </p>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.02)', padding: '0.25rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={() => setActiveTab('chats')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'chats' ? 'var(--primary-gold)' : 'transparent',
              color: activeTab === 'chats' ? '#000' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              transition: 'all 0.2s'
            }}
          >
            <MessageSquare size={16} />
            Conversas Ativas
            {activeChats.filter(c => c.unreadByOperator).length > 0 && (
              <span style={{
                background: '#ef4444',
                color: '#fff',
                borderRadius: '10px',
                padding: '0.1rem 0.35rem',
                fontSize: '0.7rem'
              }}>
                {activeChats.filter(c => c.unreadByOperator).length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('treinamento')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === 'treinamento' ? 'var(--primary-gold)' : 'transparent',
              color: activeTab === 'treinamento' ? '#000' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              transition: 'all 0.2s'
            }}
          >
            <Settings size={16} />
            Treinamento da I.A.
          </button>
        </div>
      </div>

      {/* Main Content Areas based on tabs */}
      {activeTab === 'chats' ? (
        <div style={{
          display: 'flex',
          flex: 1,
          gap: isMobile ? '0' : '1rem',
          minHeight: 0, // Allows flex-child scrolling
          overflow: 'hidden',
          flexDirection: isMobile ? 'column' : 'row'
        }}>
          
          {/* Chat Sessions list (Left side) */}
          {(!isMobile || !selectedChatId) && (
            <div style={{
              flex: isMobile ? '1' : '0 0 280px',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              width: isMobile ? '100%' : 'auto'
            }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Fila de Clientes ({activeChats.length})
              </div>
              
              {activeChats.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Nenhuma conversa iniciada.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {activeChats.map((c) => {
                    const isSelected = selectedChatId === c.clientUid;
                    const lastMsg = c.messages[c.messages.length - 1];

                    // Check if AI conversation has been active for >= 120 minutes
                    const isAiConversationLong = (() => {
                      if (!c.assistantActive || !c.messages || c.messages.length === 0) return false;
                      const firstMsg = c.messages[0];
                      const firstTime = new Date(firstMsg.timestamp).getTime();
                      const now = new Date().getTime();
                      const diffMinutes = (now - firstTime) / (1000 * 60);
                      return diffMinutes >= 120;
                    })();

                    return (
                      <button
                        key={c.clientUid}
                        onClick={() => setSelectedChatId(c.clientUid)}
                        className={isAiConversationLong ? 'blink-alert-chat' : ''}
                        style={{
                          padding: '0.85rem 1rem',
                          border: 'none',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                          background: isSelected ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: '0.25rem',
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                          transition: 'background 0.2s'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, color: '#fff', fontSize: '0.88rem' }}>
                            {c.clientName}
                          </span>
                          {c.unreadByOperator && (
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                          )}
                        </div>
                        
                        {lastMsg && (
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                            {lastMsg.sender === 'client' ? 'Cliente: ' : (lastMsg.sender === 'assistant' ? 'I.A.: ' : 'Operador: ')} {lastMsg.text}
                          </span>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginTop: '0.25rem', alignItems: 'center' }}>
                          <span style={{
                            fontSize: '0.7rem',
                            background: c.assistantActive ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                            color: c.assistantActive ? 'var(--primary-gold)' : '#10b981',
                            padding: '0.1rem 0.35rem',
                            borderRadius: '4px',
                            border: `1px solid ${c.assistantActive ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)'}`
                          }}>
                            {c.assistantActive ? 'I.A. Ativa' : 'Humano'}
                          </span>
                          
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                            {new Date(c.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Active conversation window (Right side) */}
          {(!isMobile || selectedChatId) && (
            <div style={{
              flex: 1,
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflow: 'hidden',
              width: isMobile ? '100%' : 'auto'
            }}>
              {selectedChat ? (
                <>
                  {/* Header of Chat */}
                  <div style={{
                    padding: '0.75rem 1.25rem',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(255,255,255,0.01)',
                    gap: '0.5rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      {isMobile && (
                        <button
                          onClick={() => setSelectedChatId(null)}
                          style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '6px',
                            color: '#fff',
                            padding: '0.4rem 0.6rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            transition: 'background 0.2s'
                          }}
                        >
                          <ChevronLeft size={16} />
                          Voltar
                        </button>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <span style={{ fontWeight: 600, color: '#fff', fontSize: '1rem' }}>
                          {selectedChat.clientName}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          ID: {selectedChat.clientUid}
                        </span>
                      </div>
                    </div>

                    {/* AI intervention controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button
                        onClick={() => toggleAssistantState(selectedChat)}
                        style={{
                          padding: '0.4rem 0.8rem',
                          borderRadius: '6px',
                          border: 'none',
                          background: selectedChat.assistantActive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                          color: selectedChat.assistantActive ? '#f87171' : 'var(--primary-gold)',
                          cursor: 'pointer',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          transition: 'background 0.2s'
                        }}
                      >
                        {selectedChat.assistantActive ? (
                          <>
                            <Pause size={14} />
                            {isMobile ? 'Pausar I.A.' : 'Pausar I.A. (Intervir)'}
                          </>
                        ) : (
                          <>
                            <Play size={14} />
                            {isMobile ? 'Ligar I.A.' : 'Ligar I.A. Chatbot'}
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Messages Feed */}
                  <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '1rem 1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    background: 'rgba(0,0,0,0.1)'
                  }}>
                    {selectedChat.messages.map((m, index) => {
                      const isClient = m.sender === 'client';
                      const isAI = m.sender === 'assistant';

                      return (
                        <div
                          key={index}
                          style={{
                            display: 'flex',
                            justifyContent: isClient ? 'flex-start' : 'flex-end',
                            alignItems: 'center',
                            width: '100%',
                            gap: '0.5rem'
                          }}
                        >
                          {/* Se for operador e for à direita, não precisa de botão aqui */}
                          {!isClient && (
                            <div style={{ flex: 1 }} />
                          )}
                          <div style={{
                            maxWidth: '75%',
                            padding: '0.65rem 0.85rem',
                            borderRadius: isClient ? '14px 14px 14px 2px' : '14px 14px 2px 14px',
                            background: isClient 
                              ? 'rgba(255, 255, 255, 0.04)' 
                              : (isAI ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)'),
                            border: isClient 
                              ? '1px solid rgba(255,255,255,0.06)' 
                              : (isAI ? '1px solid rgba(245,158,11,0.2)' : '1px solid rgba(16,185,129,0.2)'),
                            color: '#fff',
                            fontSize: '0.85rem',
                            lineHeight: '1.4',
                            textAlign: 'left'
                          }}>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              {isClient ? <User size={10} /> : (isAI ? <Bot size={10} /> : <User size={10} />)}
                              {isClient ? 'Cliente' : (isAI ? `Atendente Virtual (I.A.)` : `Você (Operador Humano)`)}
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>
                              {m.type === 'image' && m.mediaUrl && (
                                <img 
                                  src={m.mediaUrl} 
                                  alt="Imagem" 
                                  style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '8px', display: 'block', margin: '0.35rem 0', cursor: 'pointer' }}
                                  onClick={() => window.open(m.mediaUrl)}
                                />
                              )}
                              {m.type === 'audio' && m.mediaUrl && (
                                <audio 
                                  src={m.mediaUrl} 
                                  controls 
                                  style={{ display: 'block', margin: '0.35rem 0', maxWidth: '100%' }} 
                                />
                              )}
                              {m.type === 'location' && m.location && (
                                <div style={{
                                  background: 'rgba(0,0,0,0.2)',
                                  padding: '0.5rem',
                                  borderRadius: '8px',
                                  marginTop: '0.35rem',
                                  border: '1px solid rgba(255,255,255,0.1)'
                                }}>
                                  <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', color: 'var(--primary-gold)' }}>
                                    📍 {m.location.isRealTime ? 'Localização em Tempo Real' : 'Localização Fixa'}
                                  </div>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0.2rem 0' }}>
                                    Lat: {m.location.latitude.toFixed(6)}, Lng: {m.location.longitude.toFixed(6)}
                                  </div>
                                  {m.location.isRealTime && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: '#10b981', marginBottom: '0.35rem' }}>
                                      <span className="pulse-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                                      Transmitindo em tempo real...
                                    </div>
                                  )}
                                  <a 
                                    href={`https://www.google.com/maps?q=${m.location.latitude},${m.location.longitude}`} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    style={{
                                      display: 'inline-block',
                                      background: 'var(--primary-gold)',
                                      color: '#000',
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
                              {m.text}
                            </div>
                            <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', textAlign: 'right', marginTop: '0.2rem' }}>
                              {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                          {isClient && (
                            <button
                              onClick={() => startQuickTraining(m.text)}
                              title="Ensinar I.A. a responder isso"
                              style={{
                                background: 'rgba(245, 158, 11, 0.1)',
                                border: '1px solid rgba(245, 158, 11, 0.2)',
                                color: 'var(--primary-gold)',
                                borderRadius: '50%',
                                width: '28px',
                                height: '28px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                flexShrink: 0,
                                opacity: 0.7,
                                transition: 'all 0.2s'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                              onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                            >
                              <GraduationCap size={14} />
                            </button>
                          )}
                          {isClient && <div style={{ flex: 1 }} />}
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Hidden file input for photos (operator) */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleOperatorPhotoSelected}
                    accept="image/*"
                    style={{ display: 'none' }}
                  />

                  {/* Operator reply input box */}
                  <form onSubmit={handleSendOperatorMessage} style={{
                    padding: '1rem',
                    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'rgba(255,255,255,0.01)',
                    position: 'relative'
                  }}>
                    {isRecording ? (
                      // Recording UI mode
                      <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: '0.5rem', background: 'rgba(239, 68, 68, 0.05)', padding: '0.45rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse-red 1s infinite' }} />
                        <span style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 600 }}>Gravando... {recordingTime}s</span>
                        <div style={{ flex: 1 }} />
                        <button
                          type="button"
                          onClick={cancelOperatorRecording}
                          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          <Trash2 size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={stopAndSendOperatorRecording}
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
                          title="Enviar Foto"
                          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center' }}
                        >
                          <Image size={18} />
                        </button>

                        <button
                          type="button"
                          onClick={sendOperatorLocation}
                          title="Enviar Localização da Pastelaria"
                          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center' }}
                        >
                          <MapPin size={18} />
                        </button>

                        <button
                          type="button"
                          onClick={startOperatorRecording}
                          title="Gravar Áudio"
                          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem', display: 'flex', alignItems: 'center' }}
                        >
                          <Mic size={18} />
                        </button>

                        <input
                          type="text"
                          value={inputText}
                          onChange={(e) => setInputText(e.target.value)}
                          placeholder={selectedChat.assistantActive ? "Digite para intervir e responder diretamente (isso pausará a I.A.)..." : "Digite para responder ao cliente..."}
                          style={{
                            flex: 1,
                            padding: '0.65rem 1rem',
                            background: 'rgba(0, 0, 0, 0.3)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '0.88rem',
                            outline: 'none'
                          }}
                        />
                        
                        <button
                          type="submit"
                          disabled={!inputText.trim()}
                          style={{
                            background: inputText.trim() ? 'var(--primary-gold)' : 'rgba(255,255,255,0.04)',
                            color: inputText.trim() ? '#000' : 'var(--text-secondary)',
                            border: 'none',
                            borderRadius: '8px',
                            padding: '0 1rem',
                            height: '38px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: inputText.trim() ? 'pointer' : 'default',
                            fontWeight: 600,
                            gap: '0.35rem'
                          }}
                        >
                          <Send size={16} />
                          Enviar
                        </button>
                      </>
                    )}
                  </form>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '0.5rem', color: 'var(--text-secondary)' }}>
                  <MessageSquare size={36} />
                  <span>Selecione uma conversa para começar o atendimento</span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Training & Prompts configuration tab (treinamento) */
        <>
          <form onSubmit={handleSaveConfig} style={{
          flex: 1,
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          overflowY: 'auto'
        }}>
          <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, color: '#fff' }}>Treinamento da I.A. Atendente</h3>
            <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Forneça as diretrizes sobre como o atendente virtual deve dialogar com o cliente.
            </p>
          </div>

          {/* Nome do Assistente */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>Nome do Assistente Virtual</label>
            <input
              type="text"
              value={config.assistantName}
              onChange={(e) => setConfig({ ...config, assistantName: e.target.value })}
              placeholder="Ex: Dona Lu Assistente, Luzia, etc."
              required
              style={{
                padding: '0.65rem 1rem',
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#fff',
                outline: 'none',
                fontSize: '0.9rem'
              }}
            />
          </div>

          {/* O que FALAR (Diretrizes) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>Diretrizes Gerais (O que falar e como agir)</label>
            <textarea
              rows={4}
              value={config.aiInstructions}
              onChange={(e) => setConfig({ ...config, aiInstructions: e.target.value })}
              placeholder="Ex: Seja prestativa, use emojis, ofereça pastéis com bordas recheadas de chocolate no final do pedido, responda de forma curta..."
              required
              style={{
                padding: '0.65rem 1rem',
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#fff',
                outline: 'none',
                fontSize: '0.9rem',
                resize: 'vertical',
                lineHeight: '1.4'
              }}
            />
          </div>

          {/* O que NÃO falar (Restrições) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>Restrições Gerais (O que NÃO deve falar sob nenhuma circunstância)</label>
            <textarea
              rows={3}
              value={config.aiRestrictions}
              onChange={(e) => setConfig({ ...config, aiRestrictions: e.target.value })}
              placeholder="Ex: Não mencione pizzaria X, não dê reembolsos ou cancele pedidos sem aprovação do caixa, não prometa entrega abaixo de 20 minutos..."
              required
              style={{
                padding: '0.65rem 1rem',
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#fff',
                outline: 'none',
                fontSize: '0.9rem',
                resize: 'vertical',
                lineHeight: '1.4'
              }}
            />
          </div>

          {/* Chave do Gemini */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', borderTop: '1px dashed rgba(255,255,255,0.05)', paddingTop: '1.25rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              Chave de API do Gemini (Opcional)
              <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>API Key</span>
            </label>
            <input
              type="password"
              value={config.geminiApiKey}
              onChange={(e) => setConfig({ ...config, geminiApiKey: e.target.value })}
              placeholder="Cole sua API Key do Google AI Studio..."
              style={{
                padding: '0.65rem 1rem',
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#fff',
                outline: 'none',
                fontSize: '0.9rem'
              }}
            />
            <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <AlertCircle size={12} />
              Se não informada, a I.A. responderá usando o motor de regras local inteligente (que cobre status do pedido, estoque e horários da loja).
            </p>
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '1rem' }}>
            <button
              type="submit"
              disabled={savingConfig}
              style={{
                background: saveSuccess ? '#10b981' : 'var(--primary-gold)',
                color: '#000',
                border: 'none',
                borderRadius: '8px',
                padding: '0.65rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontWeight: 600,
                gap: '0.5rem',
                transition: 'all 0.2s'
              }}
            >
              {saveSuccess ? <Check size={16} /> : <Save size={16} />}
              {savingConfig ? 'Gravando...' : (saveSuccess ? 'Configuração Salva!' : 'Salvar Treinamento')}
            </button>
          </div>
        </form>
          
          {/* List of custom Q&A training rules */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            marginTop: '1.5rem'
          }}>
            <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '0.5rem' }}>
              <h4 style={{ margin: 0, color: 'var(--primary-gold)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <GraduationCap size={18} />
                Regras de Respostas Rápidas Ensinadas ({customRules.length})
              </h4>
              <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                Perguntas específicas que você treinou a I.A. para responder de forma customizada.
              </p>
            </div>

            {customRules.length === 0 ? (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                Nenhuma regra de resposta rápida cadastrada ainda. Clique no ícone de chapéu de formatura (🎓) ao lado das mensagens dos clientes no chat para treinar.
              </span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '400px', overflowY: 'auto' }}>
                {customRules.map((rule) => (
                  <div
                    key={rule.id}
                    style={{
                      background: 'rgba(0,0,0,0.2)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      borderRadius: '8px',
                      padding: '0.75rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '1rem'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f59e0b' }}>
                        Quando perguntar: "{rule.pattern}"
                      </span>
                      <span style={{ fontSize: '0.85rem', color: '#fff' }}>
                        Responder: "{rule.response}"
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      title="Excluir regra de treinamento"
                      style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        color: '#f87171',
                        borderRadius: '4px',
                        padding: '0.35rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Quick Training Modal */}
      {showTrainingModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            width: '450px',
            maxWidth: '90%',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
          }}>
            <h3 style={{ margin: 0, color: '#fff', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <GraduationCap size={20} style={{ color: 'var(--primary-gold)' }} />
              Treinamento Rápido da I.A.
            </h3>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Defina como o atendente virtual deve responder quando o cliente enviar esta pergunta ou frases parecidas.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>Pergunta / Gatilho do Cliente</label>
              <textarea
                value={trainingPattern}
                onChange={(e) => setTrainingPattern(e.target.value)}
                rows={2}
                style={{
                  padding: '0.55rem 0.75rem',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.85rem',
                  outline: 'none',
                  resize: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>Resposta Esperada (Correta)</label>
              <textarea
                value={trainingResponse}
                onChange={(e) => setTrainingResponse(e.target.value)}
                placeholder="Digite a resposta que a I.A. deve dar de forma simples e humana..."
                rows={3}
                style={{
                  padding: '0.55rem 0.75rem',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '0.85rem',
                  outline: 'none',
                  resize: 'vertical'
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowTrainingModal(false)}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: 'none',
                  color: '#fff',
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveQuickRule}
                disabled={!trainingPattern.trim() || !trainingResponse.trim()}
                style={{
                  background: 'var(--primary-gold)',
                  border: 'none',
                  color: '#000',
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}
              >
                Salvar Regra
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupportPanel;
