import { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { Search, Clock, ListFilter, X, RefreshCw } from 'lucide-react';
import type { LogAuditParams } from '../../utils/audit';

export const SystemLogs = () => {
  
  const [logs, setLogs] = useState<LogAuditParams[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedLog, setSelectedLog] = useState<LogAuditParams | null>(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterAction, setFilterAction] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  
  const fetchLogs = async (isLoadMore = false) => {
    if (!isLoadMore) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const q = query(
        collection(db, 'audit_logs'),
        orderBy('timestamp', 'desc')
      );

      // Fetch a larger chunk for client-side filtering (ensures responsiveness & zero Firebase index failures)
      const logLimit = isLoadMore ? 500 : 250;
      const qLimit = query(q, limit(logLimit));
      const snapshot = await getDocs(qLimit);
      
      const fetchedLogs: LogAuditParams[] = [];
      snapshot.forEach((docSnap) => {
        fetchedLogs.push(docSnap.data() as LogAuditParams);
      });

      setLogs(fetchedLogs);
      setHasMore(snapshot.docs.length >= logLimit);
    } catch (error) {
      console.error("Erro ao carregar logs do sistema:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleRefresh = () => {
    fetchLogs();
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setFilterRole('all');
    setFilterAction('all');
    setFilterStartDate('');
    setFilterEndDate('');
  };

  // Safe timestamp parser (handles Firestore Timestamp objects and ISO strings)
  const formatLogTimestamp = (timestamp: any) => {
    if (!timestamp) return '-';
    try {
      if (typeof timestamp.toDate === 'function') {
        return timestamp.toDate().toLocaleString('pt-BR');
      }
      if (timestamp.seconds !== undefined) {
        return new Date(timestamp.seconds * 1000).toLocaleString('pt-BR');
      }
      return new Date(timestamp).toLocaleString('pt-BR');
    } catch (e) {
      return String(timestamp);
    }
  };

  const getLogDateObject = (timestamp: any): Date => {
    if (!timestamp) return new Date();
    if (typeof timestamp.toDate === 'function') {
      return timestamp.toDate();
    }
    if (timestamp.seconds !== undefined) {
      return new Date(timestamp.seconds * 1000);
    }
    return new Date(timestamp);
  };

  // Perform client-side filtering on fetched records
  const filteredLogs = logs.filter((log: any) => {
    // 1. Text Search
    if (searchQuery.trim() !== '') {
      const queryStr = searchQuery.toLowerCase();
      const nameMatch = log.userName?.toLowerCase().includes(queryStr);
      const emailMatch = log.userEmail?.toLowerCase().includes(queryStr);
      const descMatch = log.description?.toLowerCase().includes(queryStr);
      const actionMatch = log.actionType?.toLowerCase().includes(queryStr) || log.title?.toLowerCase().includes(queryStr);
      if (!nameMatch && !emailMatch && !descMatch && !actionMatch) {
        return false;
      }
    }

    // 2. Role Filter
    if (filterRole !== 'all') {
      if (log.userRole !== filterRole) {
        return false;
      }
    }

    // 3. Action Type Filter
    if (filterAction !== 'all') {
      const actionTypeLower = (log.actionType || '').toLowerCase();
      const titleLower = (log.title || '').toLowerCase();
      
      if (filterAction === 'order') {
        if (!actionTypeLower.includes('order') && !actionTypeLower.includes('pedido') && !titleLower.includes('pedido')) {
          return false;
        }
      } else if (filterAction === 'stock') {
        if (!actionTypeLower.includes('stock') && !actionTypeLower.includes('estoque') && !titleLower.includes('estoque')) {
          return false;
        }
      } else if (filterAction === 'user') {
        if (!actionTypeLower.includes('user') && !actionTypeLower.includes('usuario') && !titleLower.includes('usuário') && !titleLower.includes('permissão')) {
          return false;
        }
      } else if (filterAction === 'settings') {
        if (!actionTypeLower.includes('settings') && !actionTypeLower.includes('config') && !titleLower.includes('config')) {
          return false;
        }
      } else if (filterAction === 'auth') {
        if (!actionTypeLower.includes('login') && !actionTypeLower.includes('logout') && !actionTypeLower.includes('auth')) {
          return false;
        }
      }
    }

    // 4. Date Range Filters
    const logDate = getLogDateObject(log.timestamp);

    if (filterStartDate !== '') {
      const startDate = new Date(filterStartDate + 'T00:00:00');
      if (logDate < startDate) return false;
    }

    if (filterEndDate !== '') {
      const endDate = new Date(filterEndDate + 'T23:59:59');
      if (logDate > endDate) return false;
    }

    return true;
  });

  const getActionBadgeStyle = (actionType: string) => {
    let bgColor = 'rgba(255,255,255,0.05)';
    let color = 'var(--text-secondary)';
    const type = (actionType || '').toLowerCase();
    
    if (type.includes('order') || type.includes('pedido') || type.includes('checkout') || type.includes('comanda')) {
      bgColor = 'rgba(245, 158, 11, 0.12)';
      color = 'var(--primary-gold)';
    } else if (type.includes('stock') || type.includes('estoque')) {
      bgColor = 'rgba(59, 130, 246, 0.12)';
      color = '#3b82f6';
    } else if (type.includes('user') || type.includes('usuario') || type.includes('permissao')) {
      bgColor = 'rgba(168, 85, 247, 0.12)';
      color = '#a855f7';
    } else if (type.includes('settings') || type.includes('config')) {
      bgColor = 'rgba(239, 68, 68, 0.12)';
      color = '#ef4444';
    } else if (type.includes('login') || type.includes('auth') || type.includes('logout')) {
      bgColor = 'rgba(16, 185, 129, 0.12)';
      color = '#10b981';
    }

    return { backgroundColor: bgColor, color, fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 600 } as const;
  };

  const getActionLabel = (log: LogAuditParams) => {
    return log.title || log.actionType?.replace(/_/g, ' ').toUpperCase();
  };

  const getRoleBadgeStyle = (role: string) => {
    let bgColor = 'rgba(255,255,255,0.05)';
    let color = 'var(--text-secondary)';
    
    if (role === 'developer') { bgColor = 'rgba(168, 85, 247, 0.15)'; color = '#a855f7'; }
    else if (role === 'owner') { bgColor = 'rgba(245, 158, 11, 0.15)'; color = 'var(--primary-gold)'; }
    else if (role === 'manager') { bgColor = 'rgba(59, 130, 246, 0.15)'; color = '#3b82f6'; }
    else if (role === 'staff') { bgColor = 'rgba(16, 185, 129, 0.15)'; color = '#10b981'; }
    else if (role === 'client') { bgColor = 'rgba(75, 85, 99, 0.15)'; color = '#9ca3af'; }

    return { backgroundColor: bgColor, color, fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 700 } as const;
  };

  return (
    <div className="dashboard-layout">
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Registros de Atividades (Auditoria)</h2>
          <p>Acompanhamento e auditoria em tempo real de ações executadas no sistema por todos os usuários.</p>
        </div>
        <button className="logout-action-btn" onClick={handleRefresh} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> Atualizar
        </button>
      </div>

      {/* Filters Box */}
      <div className="admin-card-box" style={{ padding: '1.25rem' }}>
        <h4 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--primary-gold)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <ListFilter size={16} /> Filtros de Auditoria
        </h4>
        <div className="audit-filters-grid">
          {/* Text search */}
          <div className="search-field" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Texto de Busca</span>
            <div style={{ position: 'relative' }}>
              <input 
                type="text" 
                placeholder="Nome, email, descrição..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '0.45rem 0.75rem 0.45rem 2rem', background: 'var(--bg-darker)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
              />
              <Search size={14} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            </div>
          </div>

          {/* Role select */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Nível de Permissão</span>
            <select 
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              style={{ width: '100%', padding: '0.45rem 0.75rem', background: 'var(--bg-darker)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
            >
              <option value="all">Todos os Níveis</option>
              <option value="developer">Desenvolvedor (Developer)</option>
              <option value="owner">Proprietário (Owner)</option>
              <option value="manager">Gerente (Manager)</option>
              <option value="staff">Funcionário (Staff)</option>
              <option value="client">Cliente (Client)</option>
              <option value="guest">Visitante (Guest)</option>
            </select>
          </div>

          {/* Action category */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Categoria da Ação</span>
            <select 
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              style={{ width: '100%', padding: '0.45rem 0.75rem', background: 'var(--bg-darker)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
            >
              <option value="all">Todas as Ações</option>
              <option value="order">Operações de Pedidos</option>
              <option value="stock">Controle de Estoque</option>
              <option value="user">Gestão de Usuários</option>
              <option value="settings">Configurações do Sistema</option>
              <option value="auth">Acessos (Login/Logout)</option>
            </select>
          </div>

          {/* Date Picker Start */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>De</span>
            <input 
              type="date" 
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              style={{ width: '100%', padding: '0.45rem 0.5rem', background: 'var(--bg-darker)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
            />
          </div>

          {/* Date Picker End */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>Até</span>
            <input 
              type="date" 
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              style={{ width: '100%', padding: '0.45rem 0.5rem', background: 'var(--bg-darker)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem' }}
            />
          </div>
        </div>

        {/* Clear Filters Button */}
        {(searchQuery !== '' || filterRole !== 'all' || filterAction !== 'all' || filterStartDate !== '' || filterEndDate !== '') && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button className="logout-action-btn" onClick={handleClearFilters} style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
              Limpar Filtros
            </button>
          </div>
        )}
      </div>

      {/* Logs Table Box */}
      <div className="admin-card-box" style={{ marginTop: '1rem' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 1rem auto' }}></div>
            <span style={{ color: 'var(--text-secondary)' }}>Carregando histórico de auditoria...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Nenhum registro de atividade corresponde aos filtros aplicados.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: '150px' }}>Data / Hora</th>
                  <th style={{ width: '165px' }}>Usuário</th>
                  <th style={{ width: '90px' }}>Permissão</th>
                  <th style={{ width: '140px' }}>Ação</th>
                  <th>Descrição</th>
                  <th style={{ width: '90px', textAlign: 'center' }}>Ver Info</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log: any, idx) => (
                  <tr key={idx} className="interactive-row" onClick={() => setSelectedLog(log)}>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {formatLogTimestamp(log.timestamp)}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{log.userName}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{log.userEmail}</div>
                    </td>
                    <td>
                      <span style={getRoleBadgeStyle(log.userRole)}>{log.userRole}</span>
                    </td>
                    <td>
                      <span style={getActionBadgeStyle(log.actionType)}>{getActionLabel(log)}</span>
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      {log.description}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button 
                        className="setup-btn" 
                        onClick={(e) => { e.stopPropagation(); setSelectedLog(log); }}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderRadius: '4px' }}
                      >
                        Info
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Load More Button */}
        {hasMore && !loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.25rem 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <button 
              className="setup-btn" 
              onClick={() => fetchLogs(true)} 
              disabled={loadingMore}
              style={{ width: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              {loadingMore ? <span className="spinner" style={{ width: '12px', height: '12px', borderWidth: '1.5px' }}></span> : null}
              {loadingMore ? 'Carregando...' : 'Carregar mais registros'}
            </button>
          </div>
        )}
      </div>

      {/* Log Details Modal Overlay */}
      {selectedLog && (
        <div className="admin-modal-overlay" onClick={() => setSelectedLog(null)}>
          <div className="admin-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Clock size={18} style={{ color: 'var(--primary-gold)' }} /> Detalhes do Registro
              </h3>
              <button className="admin-modal-close-btn" onClick={() => setSelectedLog(null)}>
                <X size={18} />
              </button>
            </div>

            {/* Body contents */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="modal-kpi-container" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="modal-kpi-card">
                  <span className="modal-kpi-label">Usuário</span>
                  <span className="modal-kpi-val" style={{ fontSize: '0.95rem' }}>{selectedLog.userName}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{selectedLog.userEmail}</span>
                </div>
                <div className="modal-kpi-card">
                  <span className="modal-kpi-label">Data e Hora</span>
                  <span className="modal-kpi-val" style={{ fontSize: '0.95rem' }}>{formatLogTimestamp(selectedLog.timestamp)}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Nível: {selectedLog.userRole?.toUpperCase()}</span>
                </div>
              </div>

              <div className="modal-detail-section" style={{ borderTop: 'none', paddingTop: 0 }}>
                <h4>Ação Realizada</h4>
                <div style={{ padding: '0.75rem', background: 'var(--bg-darker)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)', marginTop: '0.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={getActionBadgeStyle(selectedLog.actionType)}>{getActionLabel(selectedLog)}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{selectedLog.actionType}</span>
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#fff', fontWeight: 500 }}>
                    {selectedLog.description}
                  </div>
                </div>
              </div>

              {selectedLog.metadata && (
                <div className="modal-detail-section">
                  <h4>Metadados da Solicitação (Payload)</h4>
                  <pre style={{ margin: '0.25rem 0 0 0', padding: '1rem', background: 'var(--bg-darker)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', overflowX: 'auto', fontSize: '0.75rem', color: '#10b981', fontFamily: 'monospace', maxHeight: '250px' }}>
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Footer closes */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem' }}>
              <button className="logout-action-btn" onClick={() => setSelectedLog(null)} style={{ background: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemLogs;
