import { useState, useRef } from "react";
import { CreditCard, Lock } from "lucide-react";

interface MercadoPagoCardFormProps {
  amount: number;
  publicKey: string;
  accessToken: string;
  payer: { email: string; name: string; cpf: string; };
  items?: Array<{ title: string; unit_price: number; quantity: number }>;
  onSuccess: (orderId: string) => void;
  onError: (message: string) => void;
}

export function MercadoPagoCardForm({
  amount, publicKey, accessToken, payer, onSuccess, onError
}: MercadoPagoCardFormProps) {
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [installments, setInstallments] = useState(1);
  const [cardType, setCardType] = useState<"credit" | "debit">("credit");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mpRef = useRef<any>(null);

  const formatCardNumber = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
  const formatExpiry = (v: string) => {
    const c = v.replace(/\D/g, "").slice(0, 4);
    return c.length >= 3 ? c.slice(0, 2) + "/" + c.slice(2) : c;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError("");
    setLoading(true);
    try {
      if (!mpRef.current) {
        if (!(window as any).MercadoPago) throw new Error("SDK do Mercado Pago nao carregado. Recarregue a pagina.");
        mpRef.current = new (window as any).MercadoPago(publicKey, { locale: "pt-BR" });
      }
      const mp = mpRef.current;
      if (!cardNumber.replace(/\s/g, "") || !cardHolder || !cardExpiry || !cardCvv)
        throw new Error("Preencha todos os campos do cartao.");
      const expiryClean = cardExpiry.replace(/\D/g, "");
      const tokenResp = await mp.createCardToken({
        cardNumber: cardNumber.replace(/\s/g, ""),
        cardholderName: cardHolder,
        cardExpirationMonth: expiryClean.slice(0, 2),
        cardExpirationYear: "20" + expiryClean.slice(2, 4),
        securityCode: cardCvv,
        identificationType: "CPF",
        identificationNumber: (payer.cpf || "").replace(/\D/g, "")
      });
      if (!tokenResp?.id) throw new Error("Nao foi possivel tokenizar o cartao.");
      let deviceSessionId: string | undefined;
      try {
        const d2id = document.cookie.split(";").find(c => c.trim().startsWith("_d2id="));
        if (d2id) deviceSessionId = d2id.split("=")[1]?.trim();
      } catch (_) {}
      const totalAmount = parseFloat(amount.toString()).toFixed(2);
      const firstName = (payer.name || 'Cliente').split(' ')[0];
      const lastName = (payer.name || 'Cliente').split(' ').slice(1).join(' ') || 'Dona Lu';

      const firstDigit = cardNumber.charAt(0);
      let paymentMethodId = cardType === "credit" ? "master" : "debmaster";
      if (firstDigit === "4") paymentMethodId = cardType === "credit" ? "visa" : "debvisa";
      else if (firstDigit === "3") paymentMethodId = "amex";
      else if (firstDigit === "6") paymentMethodId = cardType === "credit" ? "elo" : "debelo";

      const orderPayload = {
        transaction_amount: parseFloat(totalAmount),
        token: tokenResp.id,
        description: 'Pedido Dona Lu Pastelaria',
        installments: parseInt(installments.toString() || '1'),
        payment_method_id: paymentMethodId,
        payer: {
          email: payer.email || 'cliente@email.com',
          first_name: firstName,
          last_name: lastName,
          identification: {
            type: 'CPF',
            number: (payer.cpf || '').replace(/\D/g, '') || '80288053702'
          }
        }
      };

      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://localhost:5173";
      const resp = await fetch(`${API_BASE_URL}/api/pagamentos/create-mp-card-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken,
          orderPayload,
          deviceSessionId
        })
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result?.errors?.[0]?.message || result.message || "Falha no pagamento.");
      
      const paymentStatus = result.transactions?.payments?.[0]?.status || result.status;
      if (paymentStatus !== 'processed' && paymentStatus !== 'approved') {
        const detail = result.transactions?.payments?.[0]?.status_detail || result.status_detail || "Motivo desconhecido";
        throw new Error(`Pagamento recusado (${detail}). Tente outro cartao.`);
      }
      onSuccess(result.orderId || result.id);
    } catch (err: any) {
      const msg = err?.message || "Erro ao processar pagamento.";
      setError(msg);
      onError(msg);
    } finally {
      setLoading(false);
    }
  };

  const inp = {
    width: "100%", background: "rgba(255,255,255,0.07)",
    border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8,
    padding: "10px 12px", color: "#fff", fontSize: 14, outline: "none",
    boxSizing: "border-box" as const
  };

  return (
    <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)", padding: "20px", marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <CreditCard size={18} color="#009ee3" />
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 15 }}>Cartão de Crédito ou Débito</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, color: "#64748b", fontSize: 12 }}>
          <Lock size={12} /> Pagamento seguro
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(0,158,227,0.08)", borderRadius: 8, padding: "6px 10px", marginBottom: 16, border: "1px solid rgba(0,158,227,0.2)" }}>
        <span style={{ color: "#009ee3", fontSize: 12, fontWeight: 600 }}>MP</span>
        <span style={{ color: "#009ee3", fontSize: 12 }}>Processado com seguranca pelo Mercado Pago</span>
      </div>
      <div className="mp-form">
        <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#e2e8f0", fontSize: 14, cursor: "pointer" }}>
            <input type="radio" name="cardType" checked={cardType === "credit"} onChange={() => setCardType("credit")} />
            Crédito
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#e2e8f0", fontSize: 14, cursor: "pointer" }}>
            <input type="radio" name="cardType" checked={cardType === "debit"} onChange={() => setCardType("debit")} />
            Débito
          </label>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Numero do Cartao</label>
          <input type="text" inputMode="numeric" placeholder="0000 0000 0000 0000" maxLength={19} value={cardNumber} onChange={e => setCardNumber(formatCardNumber(e.target.value))} style={{ ...inp, letterSpacing: 2, fontSize: 15 }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Nome no Cartao</label>
          <input type="text" placeholder="Como impresso no cartao" value={cardHolder} onChange={e => setCardHolder(e.target.value.toUpperCase())} style={inp} />
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Validade</label>
            <input type="text" inputMode="numeric" placeholder="MM/AA" maxLength={5} value={cardExpiry} onChange={e => setCardExpiry(formatExpiry(e.target.value))} style={inp} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>CVV</label>
            <input type="text" inputMode="numeric" placeholder="123" maxLength={4} value={cardCvv} onChange={e => setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))} style={inp} />
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ color: "#94a3b8", fontSize: 12, display: "block", marginBottom: 4 }}>Parcelas</label>
          <select value={installments} onChange={e => setInstallments(parseInt(e.target.value))} style={{ ...inp, background: "rgba(30,35,50,0.95)", cursor: "not-allowed", opacity: 0.8 }} disabled>
            <option value={1}>À vista (1x) - R$ {amount.toFixed(2)}</option>
          </select>
        </div>
        {error && (
          <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 12px", color: "#f87171", fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        )}
        <button type="button" onClick={handleSubmit} disabled={loading} style={{ width: "100%", padding: "14px", background: loading ? "#334155" : "linear-gradient(135deg,#009ee3,#0070a0)", border: "none", borderRadius: 10, color: "#fff", fontSize: 15, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {loading ? "Processando..." : <><Lock size={16} /> Pagar R$ {amount.toFixed(2)}</>}
        </button>
      </div>
    </div>
  );
}
