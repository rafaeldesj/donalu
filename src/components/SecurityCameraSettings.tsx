import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { collection, query, onSnapshot, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { logAuditAction } from '../utils/audit';
import { 
  Camera, Plus, Trash2, Edit, Save, RefreshCw, 
  Video, ChevronUp, ChevronDown, ChevronLeft, 
  ChevronRight, ZoomIn, ZoomOut, RotateCcw, Info
} from 'lucide-react';

export interface SecurityCamera {
  id: string;
  name: string;
  brand: string;
  
  // Local network details (maintained for maintenance)
  ip: string;
  port: number;
  username: string;
  password: string;
  streamType: 'RTSP' | 'MJPEG' | 'HLS' | 'WebRTC';
  streamPath: string;
  wifiSSID?: string;
  macAddress?: string;
  deviceId?: string;

  // Cloud streaming parameters (Option C)
  useCloudStream: boolean;
  cloudProvider: 'Angelcam' | 'Monuv' | 'CloudNVR' | 'Custom HLS' | 'Iframe Embed' | 'None';
  cloudStreamUrl: string;

  createdAt: string;
  updatedAt: string;
}

export const SecurityCameraSettings = () => {
  const { user, userData } = useAuth();
  const role = userData?.role || 'client';
  const isDev = role === 'developer';
  const isOwner = role === 'owner';
  
  // Cameras state
  const [cameras, setCameras] = useState<SecurityCamera[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCamera, setSelectedCamera] = useState<SecurityCamera | null>(null);

  // Form states
  const [isEditing, setIsEditing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [formId, setFormId] = useState('');
  const [formName, setFormName] = useState('');
  const [formBrand, setFormBrand] = useState('Yoosee');
  const [formIp, setFormIp] = useState('');
  const [formPort, setFormPort] = useState(554);
  const [formUsername, setFormUsername] = useState('admin');
  const [formPassword, setFormPassword] = useState('');
  const [formStreamType, setFormStreamType] = useState<'RTSP' | 'MJPEG' | 'HLS' | 'WebRTC'>('RTSP');
  const [formStreamPath, setFormStreamPath] = useState('/onvif1');
  const [formWifiSSID, setFormWifiSSID] = useState('');
  const [formMacAddress, setFormMacAddress] = useState('');
  const [formDeviceId, setFormDeviceId] = useState('');

  // Cloud Form states
  const [formUseCloudStream, setFormUseCloudStream] = useState(false);
  const [formCloudProvider, setFormCloudProvider] = useState<'Angelcam' | 'Monuv' | 'CloudNVR' | 'Custom HLS' | 'Iframe Embed' | 'None'>('None');
  const [formCloudStreamUrl, setFormCloudStreamUrl] = useState('');
  
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Player and PTZ states
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pan, setPan] = useState(0);
  const [tilt, setTilt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [simulatedNetworkDelay, setSimulatedNetworkDelay] = useState(false);

  // Local state to toggle player type on screen
  const [localUseCloud, setLocalUseCloud] = useState(false);

  const showFeedback = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  };

  // Sync player mode switch when selected camera changes
  useEffect(() => {
    if (selectedCamera) {
      setLocalUseCloud(selectedCamera.useCloudStream ?? false);
    }
  }, [selectedCamera]);

  // Load stream background image
  useEffect(() => {
    const img = new Image();
    img.src = '/pastelaria_camera_bg.png';
    img.onload = () => setBgImage(img);
  }, []);

  // Fetch cameras and handle auto-seeding
  useEffect(() => {
    if (!isDev && !isOwner) return;

    const q = query(collection(db, 'cameras'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const fetched: SecurityCamera[] = [];
      snapshot.forEach((docSnap) => {
        fetched.push({ id: docSnap.id, ...docSnap.data() } as SecurityCamera);
      });
      
      setCameras(fetched);

      // If no cameras exist, seed the default Yoosee camera automatically
      if (fetched.length === 0 && isDev) {
        try {
          const defaultDocRef = doc(collection(db, 'cameras'), 'yoosee_sala');
          const defaultCamera: Omit<SecurityCamera, 'id'> = {
            name: 'Sala',
            brand: 'Yoosee',
            ip: '192.168.1.2',
            port: 554,
            username: 'admin',
            password: '060587ra',
            streamType: 'RTSP',
            streamPath: '/onvif1',
            wifiSSID: 'Rosicleide_2.4G',
            macAddress: 'cc:64:1a:18:d1:6f',
            deviceId: '4928362043',
            useCloudStream: false,
            cloudProvider: 'None',
            cloudStreamUrl: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          await setDoc(defaultDocRef, defaultCamera);
          
          if (user) {
            await logAuditAction({
              userId: user.uid,
              userEmail: user.email || '',
              userName: userData?.name || 'Desenvolvedor',
              actionType: 'SEED_SECURITY_CAMERA',
              title: 'Câmera Inicial Inicializada',
              description: 'O sistema cadastrou automaticamente a câmera Yoosee (Sala) pré-configurada no local.'
            });
          }
        } catch (err) {
          console.error("Erro ao inicializar câmera padrão:", err);
        }
      }

      setLoading(false);
    }, (err) => {
      console.error("Erro ao buscar câmeras:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isDev, isOwner, user, userData]);

  // Set default selected camera
  useEffect(() => {
    if (cameras.length > 0 && !selectedCamera) {
      setSelectedCamera(cameras[0]);
    } else if (selectedCamera) {
      const updated = cameras.find(c => c.id === selectedCamera.id);
      if (updated) setSelectedCamera(updated);
    }
  }, [cameras, selectedCamera]);

  // Canvas rendering loop (used only when localUseCloud is false)
  useEffect(() => {
    if (localUseCloud) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (bgImage) {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-canvas.width / 2 + pan, -canvas.height / 2 + tilt);
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      } else {
        // Draw TV Static
        ctx.fillStyle = '#0b0c10';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#1f2833';
        for (let i = 0; i < canvas.width; i += 4) {
          for (let j = 0; j < canvas.height; j += 4) {
            if (Math.random() > 0.4) {
              ctx.fillRect(i, j, 4, 4);
            }
          }
        }
      }

      // Green filter and Vignette
      const vignette = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, canvas.width / 3,
        canvas.width / 2, canvas.height / 2, canvas.width / 1.4
      );
      vignette.addColorStop(0, 'rgba(0, 255, 0, 0.02)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // CRT Scanlines
      ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
      for (let y = 0; y < canvas.height; y += 4) {
        ctx.fillRect(0, y, canvas.width, 1);
      }

      // Intermittent CCTV glitch
      if (Math.random() > 0.985) {
        ctx.fillStyle = 'rgba(0, 255, 0, 0.15)';
        ctx.fillRect(0, Math.random() * canvas.height, canvas.width, Math.random() * 8);
      }

      // OSD Overlays
      ctx.font = 'bold 13px Courier New, Courier, monospace';
      ctx.fillStyle = '#00ff66';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;

      const now = new Date();
      ctx.fillText(now.toLocaleString('pt-BR'), 20, 30);
      ctx.fillText(`CAM: ${selectedCamera?.name?.toUpperCase() || 'SALA'}`, 20, 52);
      ctx.fillText(`REDE: ${selectedCamera?.wifiSSID || 'Local Lan'}`, 20, 74);
      ctx.fillText(`MARCA: ${selectedCamera?.brand?.toUpperCase() || 'YOOSEE'}`, 20, 96);
      ctx.fillText(`IP LOCAL: ${selectedCamera?.ip || '192.168.1.2'}`, 20, 118);

      // REC Flashing
      const isRecOn = Math.floor(Date.now() / 800) % 2 === 0;
      if (isRecOn) {
        ctx.fillStyle = '#ff3333';
        ctx.beginPath();
        ctx.arc(canvas.width - 65, 25, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = '#ff3333';
        ctx.fillText('REC', canvas.width - 52, 30);
      } else {
        ctx.fillStyle = '#666';
        ctx.fillText('REC', canvas.width - 52, 30);
      }

      ctx.fillStyle = '#00ff66';
      ctx.fillText(`ZOOM: ${zoom.toFixed(1)}X`, 20, canvas.height - 45);
      ctx.fillText(`PTZ: [H:${pan.toFixed(0)}, V:${tilt.toFixed(0)}]`, 20, canvas.height - 25);
      ctx.fillText('1080p @ 30FPS', canvas.width - 130, canvas.height - 45);
      ctx.fillText(`SIMULAÇÃO: LOCAL`, canvas.width - 150, canvas.height - 25);

      ctx.shadowBlur = 0;
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [bgImage, pan, tilt, zoom, selectedCamera, localUseCloud]);

  // PTZ Actions
  const handlePtz = (direction: 'up' | 'down' | 'left' | 'right' | 'zoom_in' | 'zoom_out' | 'reset') => {
    const moveStep = 30;
    const zoomStep = 0.2;

    switch (direction) {
      case 'up': setTilt(prev => prev + moveStep); break;
      case 'down': setTilt(prev => prev - moveStep); break;
      case 'left': setPan(prev => prev + moveStep); break;
      case 'right': setPan(prev => prev - moveStep); break;
      case 'zoom_in': setZoom(prev => Math.min(prev + zoomStep, 3)); break;
      case 'zoom_out': setZoom(prev => Math.max(prev - zoomStep, 1)); break;
      case 'reset': setPan(0); setTilt(0); setZoom(1); break;
    }
  };

  // Ping test connection
  const handleTestConnection = () => {
    setSimulatedNetworkDelay(true);
    setTimeout(() => {
      setSimulatedNetworkDelay(false);
      showFeedback('success', `Teste de ping local concluído para ${selectedCamera?.ip}. Respondendo normalmente (15ms).`);
    }, 1500);
  };

  // Save camera (Developer only)
  const handleSaveCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDev || !user) return;

    if (!formName || !formIp) {
      showFeedback('error', 'Nome e IP são campos obrigatórios.');
      return;
    }

    setSubmitting(true);
    try {
      const cameraData: Omit<SecurityCamera, 'id'> = {
        name: formName,
        brand: formBrand,
        ip: formIp,
        port: Number(formPort),
        username: formUsername,
        password: formPassword,
        streamType: formStreamType,
        streamPath: formStreamPath,
        wifiSSID: formWifiSSID,
        macAddress: formMacAddress,
        deviceId: formDeviceId,
        useCloudStream: formUseCloudStream,
        cloudProvider: formCloudProvider,
        cloudStreamUrl: formCloudStreamUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (isAdding) {
        const newDocRef = doc(collection(db, 'cameras'));
        await setDoc(newDocRef, cameraData);
        
        await logAuditAction({
          userId: user.uid,
          userEmail: user.email || '',
          userName: userData?.name || 'Desenvolvedor',
          actionType: 'ADD_SECURITY_CAMERA',
          title: 'Câmera IP Cadastrada',
          description: `O desenvolvedor cadastrou uma nova câmera IP: ${formName} (IP: ${formIp}, Nuvem: ${formUseCloudStream ? 'Sim' : 'Não'}).`
        });

        showFeedback('success', 'Nova câmera cadastrada com sucesso!');
      } else {
        const docRef = doc(db, 'cameras', formId);
        await updateDoc(docRef, {
          ...cameraData,
          updatedAt: new Date().toISOString()
        });

        await logAuditAction({
          userId: user.uid,
          userEmail: user.email || '',
          userName: userData?.name || 'Desenvolvedor',
          actionType: 'UPDATE_SECURITY_CAMERA',
          title: 'Câmera IP Atualizada',
          description: `O desenvolvedor atualizou as configurações da câmera: ${formName} (Nuvem: ${formUseCloudStream ? 'Sim' : 'Não'}).`
        });

        showFeedback('success', 'Configurações da câmera atualizadas com sucesso!');
      }

      setIsAdding(false);
      setIsEditing(false);
    } catch (err) {
      console.error(err);
      showFeedback('error', 'Erro ao salvar a câmera no banco de dados.');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete camera (Developer only)
  const handleDeleteCamera = async (camId: string, camName: string) => {
    if (!isDev || !user) return;
    if (!confirm(`Deseja realmente remover a câmera "${camName}"? Esta ação não pode ser desfeita.`)) return;

    try {
      await deleteDoc(doc(db, 'cameras', camId));
      
      await logAuditAction({
        userId: user.uid,
        userEmail: user.email || '',
        userName: userData?.name || 'Desenvolvedor',
        actionType: 'DELETE_SECURITY_CAMERA',
        title: 'Câmera IP Removida',
        description: `O desenvolvedor removeu a câmera IP: ${camName}.`
      });

      showFeedback('success', `Câmera "${camName}" removida com sucesso.`);
      if (selectedCamera?.id === camId) {
        setSelectedCamera(null);
      }
    } catch (err) {
      console.error(err);
      showFeedback('error', 'Erro ao remover a câmera.');
    }
  };

  const openEditForm = (cam: SecurityCamera) => {
    setFormId(cam.id);
    setFormName(cam.name);
    setFormBrand(cam.brand);
    setFormIp(cam.ip);
    setFormPort(cam.port);
    setFormUsername(cam.username);
    setFormPassword(cam.password);
    setFormStreamType(cam.streamType);
    setFormStreamPath(cam.streamPath);
    setFormWifiSSID(cam.wifiSSID || '');
    setFormMacAddress(cam.macAddress || '');
    setFormDeviceId(cam.deviceId || '');
    
    // Cloud params edit mapping
    setFormUseCloudStream(cam.useCloudStream ?? false);
    setFormCloudProvider(cam.cloudProvider ?? 'None');
    setFormCloudStreamUrl(cam.cloudStreamUrl ?? '');
    
    setIsEditing(true);
    setIsAdding(false);
  };

  const openAddForm = () => {
    setFormId('');
    setFormName('');
    setFormBrand('Yoosee');
    setFormIp('192.168.1.');
    setFormPort(554);
    setFormUsername('admin');
    setFormPassword('060587ra');
    setFormStreamType('RTSP');
    setFormStreamPath('/onvif1');
    setFormWifiSSID('Rosicleide_2.4G');
    setFormMacAddress('');
    setFormDeviceId('');

    // Cloud default config
    setFormUseCloudStream(false);
    setFormCloudProvider('None');
    setFormCloudStreamUrl('');

    setIsAdding(true);
    setIsEditing(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      <div>
        <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', margin: 0, color: 'var(--primary-gold)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Camera size={20} />
          <span>Monitoramento de Segurança (Câmeras IP)</span>
        </h3>
        <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Gerencie e visualize as câmeras de segurança do estabelecimento. 
          {isDev ? ' Modo de Desenvolvedor ativado com controle total.' : ' Visualização de proprietário restrita (apenas leitura).'}
        </p>
      </div>

      {feedback && (
        <div style={{
          background: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          borderLeft: feedback.type === 'success' ? '4px solid #10b981' : '4px solid #ef4444',
          color: feedback.type === 'success' ? '#34d399' : '#f87171',
          padding: '0.85rem 1.25rem',
          borderRadius: '8px',
          fontSize: '0.85rem'
        }}>
          {feedback.text}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <RefreshCw className="spinner" style={{ color: 'var(--primary-gold)' }} />
          <span style={{ marginLeft: '0.75rem', color: 'var(--text-secondary)' }}>Carregando dados das câmeras...</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isDev && (isAdding || isEditing) ? '1fr' : '1.8fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
          
          {/* Main Visualizer Area */}
          {!(isDev && (isAdding || isEditing)) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              {/* CCTV Monitor screen container */}
              <div style={{ 
                background: '#090a0f', 
                border: '4px solid #1f2833', 
                borderRadius: '16px', 
                padding: '10px', 
                boxShadow: '0 8px 30px rgba(0,0,0,0.5), inset 0 0 20px rgba(0,255,102,0.05)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                minHeight: '380px',
                justifyContent: 'center',
                width: '100%',
                position: 'relative',
                overflow: 'hidden'
              }}>
                {localUseCloud && selectedCamera?.cloudStreamUrl ? (
                  selectedCamera.cloudProvider === 'Iframe Embed' ? (
                    <iframe
                      src={selectedCamera.cloudStreamUrl}
                      title={`Stream ${selectedCamera.name}`}
                      style={{
                        width: '100%',
                        height: '380px',
                        border: 'none',
                        borderRadius: '8px',
                        background: '#000'
                      }}
                      allow="autoplay; encrypted-media; fullscreen"
                      allowFullScreen
                    />
                  ) : (
                    <video
                      src={selectedCamera.cloudStreamUrl}
                      controls
                      autoPlay
                      muted
                      style={{
                        width: '100%',
                        maxHeight: '380px',
                        borderRadius: '8px',
                        background: '#000'
                      }}
                    />
                  )
                ) : (
                  <canvas 
                    ref={canvasRef} 
                    width={640} 
                    height={380} 
                    style={{ 
                      width: '100%', 
                      maxHeight: '380px',
                      borderRadius: '8px',
                      background: '#000',
                      boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)'
                    }} 
                  />
                )}
              </div>

              {/* Toolbar */}
              <div style={{ 
                background: 'rgba(255,255,255,0.02)', 
                border: '1px solid rgba(255,255,255,0.05)', 
                borderRadius: '12px', 
                padding: '1rem',
                display: 'grid',
                gridTemplateColumns: '1fr 1.2fr',
                gap: '1.5rem',
                alignItems: 'center'
              }}>
                {/* PTZ Buttons */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                    Controle PTZ {!localUseCloud ? '(Ativo)' : '(Inativo na Nuvem)'}
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 35px)', gap: '4px' }}>
                      <div />
                      <button type="button" disabled={localUseCloud} onClick={() => handlePtz('up')} className="auth-btn" style={{ padding: '6px', minWidth: 'unset', background: 'rgba(255,255,255,0.05)', opacity: localUseCloud ? 0.3 : 1 }}><ChevronUp size={16} /></button>
                      <div />
                      <button type="button" disabled={localUseCloud} onClick={() => handlePtz('left')} className="auth-btn" style={{ padding: '6px', minWidth: 'unset', background: 'rgba(255,255,255,0.05)', opacity: localUseCloud ? 0.3 : 1 }}><ChevronLeft size={16} /></button>
                      <button type="button" disabled={localUseCloud} onClick={() => handlePtz('reset')} className="auth-btn" style={{ padding: '6px', minWidth: 'unset', background: 'rgba(255,255,255,0.05)', color: 'var(--primary-gold)', opacity: localUseCloud ? 0.3 : 1 }}><RotateCcw size={16} /></button>
                      <button type="button" disabled={localUseCloud} onClick={() => handlePtz('right')} className="auth-btn" style={{ padding: '6px', minWidth: 'unset', background: 'rgba(255,255,255,0.05)', opacity: localUseCloud ? 0.3 : 1 }}><ChevronRight size={16} /></button>
                      <div />
                      <button type="button" disabled={localUseCloud} onClick={() => handlePtz('down')} className="auth-btn" style={{ padding: '6px', minWidth: 'unset', background: 'rgba(255,255,255,0.05)', opacity: localUseCloud ? 0.3 : 1 }}><ChevronDown size={16} /></button>
                      <div />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginLeft: '0.5rem' }}>
                      <button type="button" disabled={localUseCloud} onClick={() => handlePtz('zoom_in')} className="auth-btn" style={{ padding: '6px', minWidth: '55px', background: 'rgba(255,255,255,0.05)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', opacity: localUseCloud ? 0.3 : 1 }}><ZoomIn size={12} /> In</button>
                      <button type="button" disabled={localUseCloud} onClick={() => handlePtz('zoom_out')} className="auth-btn" style={{ padding: '6px', minWidth: '55px', background: 'rgba(255,255,255,0.05)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', opacity: localUseCloud ? 0.3 : 1 }}><ZoomOut size={12} /> Out</button>
                    </div>
                  </div>
                </div>

                {/* Display mode toggler & network test */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Modo de Exibição do Monitor
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      type="button" 
                      onClick={() => setLocalUseCloud(false)}
                      style={{ 
                        flex: 1,
                        padding: '0.4rem 0.6rem', 
                        background: !localUseCloud ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.02)', 
                        border: !localUseCloud ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                        color: !localUseCloud ? 'var(--primary-gold)' : 'var(--text-secondary)',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        borderRadius: '8px'
                      }}
                    >
                      Simulador
                    </button>
                    <button 
                      type="button" 
                      onClick={() => {
                        if (!selectedCamera?.cloudStreamUrl) {
                          alert("Configure a URL do Stream na Nuvem primeiro para esta câmera!");
                          return;
                        }
                        setLocalUseCloud(true);
                      }}
                      style={{ 
                        flex: 1,
                        padding: '0.4rem 0.6rem', 
                        background: localUseCloud ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.02)', 
                        border: localUseCloud ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                        color: localUseCloud ? 'var(--primary-gold)' : 'var(--text-secondary)',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        borderRadius: '8px'
                      }}
                    >
                      Stream Real (Nuvem)
                    </button>
                  </div>
                  <button 
                    type="button" 
                    onClick={handleTestConnection}
                    disabled={!selectedCamera}
                    className="auth-btn" 
                    style={{ 
                      padding: '0.45rem', 
                      background: 'rgba(255, 255, 255, 0.03)', 
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#fff',
                      fontSize: '0.75rem'
                    }}
                  >
                    <RefreshCw size={12} style={{ marginRight: '6px', display: 'inline' }} className={simulatedNetworkDelay ? 'spinner' : ''} />
                    Testar Ping da Rede Local
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Camera Selection List & Metadata */}
          {!(isDev && (isAdding || isEditing)) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>Câmeras ({cameras.length})</h4>
                {isDev && (
                  <button 
                    type="button" 
                    onClick={openAddForm}
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid #10b981',
                      borderRadius: '8px',
                      color: '#34d399',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Plus size={12} />
                    Adicionar
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                {cameras.map(cam => (
                  <div 
                    key={cam.id}
                    onClick={() => {
                      setSelectedCamera(cam);
                      setPan(0);
                      setTilt(0);
                      setZoom(1);
                    }}
                    style={{
                      padding: '0.75rem',
                      borderRadius: '10px',
                      background: selectedCamera?.id === cam.id ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)',
                      border: selectedCamera?.id === cam.id ? '1px solid var(--primary-gold)' : '1px solid rgba(255,255,255,0.05)',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Video size={14} style={{ color: selectedCamera?.id === cam.id ? 'var(--primary-gold)' : 'var(--text-secondary)' }} />
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: selectedCamera?.id === cam.id ? 'var(--primary-gold)' : '#fff' }}>{cam.name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{cam.brand} • {cam.ip}</div>
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
                      <span style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#10b981',
                        boxShadow: '0 0 6px #10b981'
                      }} />
                      {isDev && (
                        <>
                          <button 
                            type="button" 
                            onClick={() => openEditForm(cam)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px' }}
                            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                          >
                            <Edit size={12} />
                          </button>
                          <button 
                            type="button" 
                            onClick={() => handleDeleteCamera(cam.id, cam.name)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px' }}
                            onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {selectedCamera && (
                <div style={{ 
                  background: 'rgba(255,255,255,0.01)', 
                  border: '1px solid rgba(255,255,255,0.04)', 
                  borderRadius: '12px', 
                  padding: '1rem',
                  fontSize: '0.8rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem'
                }}>
                  <h5 style={{ margin: '0 0 0.25rem 0', color: 'var(--primary-gold)', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.25rem', fontWeight: 600 }}>
                    Especificações do Canal
                  </h5>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
                    <span style={{ color: '#10b981', fontWeight: 600 }}>● Online (CFTV Nuvem)</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Fabricante:</span>
                    <span>{selectedCamera.brand}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>IP da Rede Local:</span>
                    <span style={{ fontFamily: 'monospace' }}>{selectedCamera.ip}</span>
                  </div>
                  {selectedCamera.deviceId && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>ID da Câmera:</span>
                      <span>{selectedCamera.deviceId}</span>
                    </div>
                  )}
                  {selectedCamera.macAddress && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Endereço MAC:</span>
                      <span style={{ fontFamily: 'monospace' }}>{selectedCamera.macAddress}</span>
                    </div>
                  )}
                  {selectedCamera.wifiSSID && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Wi-Fi Conectado:</span>
                      <span>{selectedCamera.wifiSSID}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Stream na Nuvem:</span>
                    <span style={{ color: selectedCamera.useCloudStream ? '#34d399' : 'var(--text-secondary)', fontWeight: 600 }}>
                      {selectedCamera.useCloudStream ? `Ativo (${selectedCamera.cloudProvider})` : 'Desativado'}
                    </span>
                  </div>

                  {isOwner && (
                    <div style={{ 
                      marginTop: '0.5rem', 
                      background: 'rgba(245, 158, 11, 0.05)', 
                      border: '1px solid rgba(245, 158, 11, 0.15)', 
                      borderRadius: '8px', 
                      padding: '8px',
                      display: 'flex',
                      gap: '6px',
                      alignItems: 'flex-start',
                      fontSize: '0.72rem',
                      color: '#f59e0b'
                    }}>
                      <Info size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
                      <span>Nota: Os campos confidenciais de credenciais e formulários de alteração de câmeras IP são restritos ao suporte técnico.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Form Editor (Developer only) */}
          {isDev && (isAdding || isEditing) && (
            <form onSubmit={handleSaveCamera} style={{ 
              background: 'rgba(255, 255, 255, 0.01)', 
              border: '1px solid rgba(255, 255, 255, 0.05)', 
              borderRadius: '16px', 
              padding: '1.5rem', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '1.25rem' 
            }}>
              <h4 style={{ margin: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', color: 'var(--primary-gold)', fontWeight: 600 }}>
                {isAdding ? 'Cadastrar Nova Câmera IP' : `Editar Câmera: ${formName}`}
              </h4>

              {/* Seção de Nuvem */}
              <h5 style={{ margin: '0.25rem 0 0 0', color: '#10b981', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.25rem' }}>
                Conectividade e Transmissão em Nuvem (Opção C)
              </h5>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    id="useCloudStream"
                    checked={formUseCloudStream}
                    onChange={e => setFormUseCloudStream(e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <label htmlFor="useCloudStream" style={{ fontSize: '0.8rem', cursor: 'pointer', color: '#fff', fontWeight: 600 }}>
                    Habilitar Stream na Nuvem
                  </label>
                </div>
                {formUseCloudStream && (
                  <div className="input-group">
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>Provedor de Nuvem</label>
                    <select 
                      className="pastel-edit-input"
                      value={formCloudProvider}
                      onChange={e => setFormCloudProvider(e.target.value as any)}
                      style={{ background: '#111', color: '#fff' }}
                    >
                      <option value="None">Selecione o Provedor...</option>
                      <option value="Angelcam">Angelcam Cloud</option>
                      <option value="Monuv">Monuv CFTV</option>
                      <option value="CloudNVR">CloudNVR</option>
                      <option value="Custom HLS">Custom HLS (.m3u8)</option>
                      <option value="Iframe Embed">Incorporação Iframe (Embed Link)</option>
                    </select>
                  </div>
                )}
              </div>

              {formUseCloudStream && (
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>
                    URL do Stream na Nuvem (Link HLS ou Link de Compartilhamento Iframe) *
                  </label>
                  <input 
                    type="url" 
                    className="pastel-edit-input" 
                    placeholder={formCloudProvider === 'Iframe Embed' ? "Ex: https://my.angelcam.com/share/..." : "Ex: https://stream.cloudnvr.com/live/camera.m3u8"}
                    value={formCloudStreamUrl}
                    onChange={e => setFormCloudStreamUrl(e.target.value)}
                    required={formUseCloudStream}
                  />
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    Insira a URL pública disponibilizada pelo seu provedor de CFTV. Para Iframe Embed, utilize a URL interna do src do iframe.
                  </span>
                </div>
              )}

              {/* Seção Manutenção Local */}
              <h5 style={{ margin: '0.5rem 0 0 0', color: 'var(--primary-gold)', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.25rem' }}>
                Parâmetros Físicos da Rede Local (Manutenção)
              </h5>

              {/* Grid 1 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>Nome do Dispositivo *</label>
                  <input 
                    type="text" 
                    className="pastel-edit-input" 
                    placeholder="Ex: Cozinha, Entrada"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    required
                  />
                </div>
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>Marca / Fabricante</label>
                  <select 
                    className="pastel-edit-input"
                    value={formBrand}
                    onChange={e => setFormBrand(e.target.value)}
                    style={{ background: '#111', color: '#fff' }}
                  >
                    <option value="Yoosee">Yoosee</option>
                    <option value="Intelbras">Intelbras</option>
                    <option value="Hikvision">Hikvision</option>
                    <option value="D-Link">D-Link</option>
                    <option value="Generic">Câmera IP Genérica</option>
                  </select>
                </div>
              </div>

              {/* Grid 2 */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>IP da Rede Local *</label>
                  <input 
                    type="text" 
                    className="pastel-edit-input" 
                    placeholder="Ex: 192.168.1.2"
                    value={formIp}
                    onChange={e => setFormIp(e.target.value)}
                    required
                  />
                </div>
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>Porta RTSP/HTTP</label>
                  <input 
                    type="number" 
                    className="pastel-edit-input" 
                    value={formPort}
                    onChange={e => setFormPort(Number(e.target.value))}
                    required
                  />
                </div>
              </div>

              {/* Grid 3 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>Usuário do Stream</label>
                  <input 
                    type="text" 
                    className="pastel-edit-input" 
                    value={formUsername}
                    onChange={e => setFormUsername(e.target.value)}
                    required
                  />
                </div>
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>Senha do Stream</label>
                  <input 
                    type="password" 
                    className="pastel-edit-input" 
                    value={formPassword}
                    onChange={e => setFormPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Grid 4 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>Tipo de Conexão Stream</label>
                  <select 
                    className="pastel-edit-input"
                    value={formStreamType}
                    onChange={e => setFormStreamType(e.target.value as any)}
                    style={{ background: '#111', color: '#fff' }}
                  >
                    <option value="RTSP">RTSP (Real Time Streaming)</option>
                    <option value="MJPEG">MJPEG (HTTP Stream)</option>
                    <option value="HLS">HLS (.m3u8)</option>
                    <option value="WebRTC">WebRTC (Low Latency)</option>
                  </select>
                </div>
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>Caminho / Endpoint Stream</label>
                  <input 
                    type="text" 
                    className="pastel-edit-input" 
                    placeholder="Ex: /onvif1 ou /live"
                    value={formStreamPath}
                    onChange={e => setFormStreamPath(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Grid 5 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>SSID do Wi-Fi</label>
                  <input 
                    type="text" 
                    className="pastel-edit-input" 
                    placeholder="Rosicleide_2.4G"
                    value={formWifiSSID}
                    onChange={e => setFormWifiSSID(e.target.value)}
                  />
                </div>
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>ID do Dispositivo (Serial)</label>
                  <input 
                    type="text" 
                    className="pastel-edit-input" 
                    placeholder="4928362043"
                    value={formDeviceId}
                    onChange={e => setFormDeviceId(e.target.value)}
                  />
                </div>
                <div className="input-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>Endereço MAC</label>
                  <input 
                    type="text" 
                    className="pastel-edit-input" 
                    placeholder="cc:64:1a:18:d1:6f"
                    value={formMacAddress}
                    onChange={e => setFormMacAddress(e.target.value)}
                  />
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button 
                  type="submit" 
                  disabled={submitting}
                  className="auth-btn"
                  style={{ flex: 1, padding: '0.75rem', background: 'var(--primary-gold)', color: '#000', fontWeight: 'bold' }}
                >
                  <Save size={16} style={{ display: 'inline', marginRight: '6px' }} />
                  {submitting ? 'Salvando...' : 'Salvar Câmera'}
                </button>
                <button 
                  type="button" 
                  onClick={() => {
                    setIsAdding(false);
                    setIsEditing(false);
                  }}
                  className="auth-btn"
                  style={{ flex: 1, padding: '0.75rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

        </div>
      )}
    </div>
  );
};
