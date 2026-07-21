# 📋 DOCUMENTAÇÃO DO PROJETO: DONA LU PASTELARIA

> **💡 INSTRUÇÃO PARA LLMs / ASSISTENTES DE IA:**
> Leia este arquivo completo antes de realizar qualquer alteração no código. Ele contém o mapeamento de arquivos, regras de negócio cruciais, fluxos de integração e lógica de autenticação customizada para que você ganhe tempo e evite reanalisar todo o projeto.
> **Importante:** Sempre que você implementar algo novo ou refatorar o sistema, atualize esta documentação para refletir as mudanças.

---

## 🛠️ Stack Tecnológica

- **Frontend:** React 19 + TypeScript + Vite 8.
- **Estilização:** CSS Vanilla (puro) com variáveis e design customizado em [index.css](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/index.css).
- **Banco de Dados & Autenticação:** Firebase Firestore & Firebase Authentication.
- **APIs de Pagamento:**
  - **PagBank:** Integração de pagamentos por PIX, Cartão de Crédito e Débito.
  - **Mercado Pago (Point):** Integração com maquininhas de cartão físicas via API de Payment Intents e OAuth.
- **Roteamento & Telas:** SPA (Single Page Application) baseada em estado dinâmico (`activeView` no [App.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/App.tsx)).
- **Outras Bibliotecas:**
  - `leaflet` + `react-leaflet` para mapas e cálculo de frete geolocalizado.
  - `lucide-react` para ícones.
  - `html5-qrcode` para leitura de QR Code de mesas.

---

## 📁 Estrutura de Diretórios e Mapeamento de Arquivos

### 🌐 Backend / Funções Serverless (Vercel)
As funções de backend ficam localizadas na pasta `/api` e rodam como serverless functions (ambiente Node.js).
- [api/mercadopago/exchange-token.js](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/api/mercadopago/exchange-token.js): Efetua a troca do `code` do OAuth do Mercado Pago pelo token de acesso do lojista.
- [api/pagamentos/process-payment.js](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/api/pagamentos/process-payment.js): Processa transações via PagBank.
- [api/pagamentos/create-pix.js](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/api/pagamentos/create-pix.js) & [check-pix.js](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/api/pagamentos/check-pix.js): Criação e checagem de status de PIX.
- [api/pagamentos/create-point-order.js](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/api/pagamentos/create-point-order.js) & [check-point-order.js](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/api/pagamentos/check-point-order.js): Cria e consulta intenções de pagamento enviadas para a maquininha física Mercado Pago Point.

> **⚙️ Simulador de API Local (Vite Dev Server):**
> No desenvolvimento local, as chamadas para `/api/*` são interceptadas via middleware customizado configurado no [vite.config.ts](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/vite.config.ts), que importa e redireciona os requests para o arquivo [payment-middleware.js](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/payment-middleware.js). Isso permite testar as APIs localmente sem precisar subir um servidor Node separado.

---

### 💻 Frontend Source Code (`/src`)

#### 💼 Contexto & Autenticação
- [src/context/AuthContext.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/context/AuthContext.tsx): Contém o estado de autenticação global e dados de perfil do usuário. **Possui uma lógica híbrida importante (ver seção específica abaixo).**
- [src/hooks/useAuth.ts](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/hooks/useAuth.ts): Hook helper de atalho para acessar o AuthContext.

#### 🗂️ Definições de Tipos (TypeScript)
- [src/types/user.ts](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/types/user.ts): Define `UserRole` (`'developer' | 'owner' | 'manager' | 'staff' | 'client'`), funções de equipe `StaffFunctions` (`cook`, `attendant`, `cashier`, `delivery`) e a estrutura do perfil do usuário `UserDocument`.
- [src/types/order.ts](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/types/order.ts): Define os estados de pedido `OrderStatus` (`'pending' | 'preparing' | 'ready' | 'delivering' | 'completed' | 'cancelled' | 'aguardando_caixa' | 'pendente_pagamento' | 'awaiting_payment'`) e a estrutura do pedido `OrderDocument`.

#### 🗺️ Componentes Globais
- [src/components/DeliveryMap.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/components/DeliveryMap.tsx): Componente Leaflet para exibição interativa de rotas, endereços e rastreamento de entregadores em tempo real.
- [src/components/TableQrCodeGenerator.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/components/TableQrCodeGenerator.tsx): Interface para gerar QR Codes específicos para as mesas físicas do estabelecimento.
- [src/components/SecurityCameraSettings.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/components/SecurityCameraSettings.tsx): Painel de configuração de monitoramento e visualização de câmeras de segurança locais.

#### 📄 Páginas & Dashboards (`/src/pages`)
- **Configurações:**
  - [src/pages/SettingsPage.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/pages/SettingsPage.tsx): Painel de configuração geral da pastelaria (credenciais PagBank/Mercado Pago, configuração de impressoras térmicas, taxas, horários de funcionamento e chaves OAuth).
- **Cliente:**
  - [src/pages/client/ClientDashboard.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/pages/client/ClientDashboard.tsx): Tela principal do cliente contendo o Cardápio Digital com categorias, carrinho, preenchimento de endereço e checkout.
  - [src/pages/client/OrderTracking.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/pages/client/OrderTracking.tsx): Acompanhamento visual dos status do pedido em tempo real.
- **Funcionários (Cozinha, Caixa e Atendimento):**
  - [src/pages/staff/StaffDashboard.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/pages/staff/StaffDashboard.tsx): Painel unificado de tarefas operacionais. Filtra os pedidos com base no cargo do funcionário logado (exibe a fila de preparo para `cook`, fila de entrega/balcão para `attendant`, e controle financeiro de pagamentos pendentes para `cashier`).
  - [src/pages/staff/TableMap.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/pages/staff/TableMap.tsx): Mapa gráfico das mesas do salão indicando ocupação e status dos pedidos locais.
- **Entregadores:**
  - [src/pages/delivery/DeliveryActive.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/pages/delivery/DeliveryActive.tsx): Painel de entregas ativas com mapa de rota do entregador até o cliente.
  - [src/pages/delivery/DeliveryHistory.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/pages/delivery/DeliveryHistory.tsx): Relatório de entregas finalizadas pelo entregador logado.
- **Gerentes / Proprietários:**
  - [src/pages/manager/AdminDashboard.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/pages/manager/AdminDashboard.tsx): Visão geral do faturamento diário/mensal, quantidade de pedidos e gráficos gerenciais.
  - [src/pages/manager/UserManagement.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/pages/manager/UserManagement.tsx): Controle de usuários cadastrados, atribuição de cargos (`role`) e ativação de funções (`staffFunctions`).
  - [src/pages/manager/ManagerDeliveryActive.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/pages/manager/ManagerDeliveryActive.tsx): Painel gerencial para acompanhar a localização física em tempo real de todos os entregadores ativos no mapa.

#### 🔧 Utilitários & Helpers (`/src/utils`)
- [src/utils/printer.ts](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/utils/printer.ts): Conexão e comandos ESC/POS para impressão de cupom fiscal em impressoras térmicas Bluetooth/Serial/Rede.
- [src/utils/geocoding.ts](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/utils/geocoding.ts): Lógica de conversão de endereços em coordenadas e cálculo de distância de entrega em relação à loja.
- [src/utils/loyalty.ts](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/utils/loyalty.ts): Regras do programa de fidelidade (selos e prêmios baseados em consumo).
- [src/utils/audit.ts](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/utils/audit.ts): Função utilitária para gravar logs de auditoria de alterações críticas diretamente em uma coleção no Firestore.

---

## 🔐 Sistema de Autenticação Customizado (Híbrido)

Para permitir que clientes entrem facilmente sem precisar obrigatoriamente de e-mails válidos padrão e verificação SMS de telefone convencional, o projeto utiliza um **fluxo híbrido** modificado no [AuthContext.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/context/AuthContext.tsx):

1. **Login por Telefone ou E-mail:**
   - O campo de login aceita tanto e-mail quanto número de telefone (com ou sem formatação).
   - Se o input for identificado como telefone (ou e-mail que já possua senha gravada no banco), o sistema faz uma consulta na coleção `users` do Firestore.
   - Ele compara a senha inserida diretamente com o campo `password` (ou `tempPassword`) salvo no documento do usuário no Firestore.
   - Se os dados coincidirem, o sistema faz o login diretamente através de um mock do usuário Firebase e armazena a sessão localmente no `localStorage` com a chave `donalu_session` contendo o `{ uid }`.
   - Se a senha do Firestore não for encontrada ou a conta usar o fluxo padrão do Firebase Auth, ele recorre ao método padrão `signInWithEmailAndPassword` da biblioteca do Firebase.

2. **Registro de Usuários:**
   - Ao registrar um novo usuário com `registerWithEmail`, a senha é salva em texto puro no campo `password` do documento do Firestore para possibilitar a consulta rápida de credenciais do login híbrido.

3. **Carga da Sessão:**
   - No início da aplicação, o hook verifica primeiro a existência de `donalu_session` no `localStorage`. Se houver, carrega os dados do perfil do Firestore antes de qualquer chamada do Firebase Auth para agilizar o tempo de carregamento.

---

## 💳 Integração com Maquininha Mercado Pago Point (MOCK / Fallback)

As requisições para a maquininha física dependem da comunicação com a API de Point do Mercado Pago (`/api/pagamentos/create-point-order.js`).
Para garantir que o fluxo de vendas do balcão e testes do desenvolvedor não fiquem bloqueados em caso de falha de conexão ou credenciais inválidas:

- **Modo Mock automático:** Caso a credencial `token` esteja ausente ou seja igual a `'mock'`, ou o `deviceId` da maquininha selecionada seja `'mock'`, a API entra em modo simulação.
- **Aprovação automática:** O mock gera um ID de pagamento temporário (`INTENT_MOCK_...`) com status `OPEN` e, por meio de um `setTimeout` em backend, altera o status do pagamento no servidor global temporário para `FINISHED` (aprovado) após **10 segundos**.
- **Fallback resiliente:** Se o request oficial à API real do Mercado Pago falhar por qualquer motivo de rede/credenciais, a API do backend intercepta a falha e aciona o modo mock de fallback de forma transparente, permitindo que a operação continue sob simulação em ambiente de desenvolvimento.

---

## 📌 Variáveis de Ambiente (`.env`)

Para o funcionamento completo da aplicação, as seguintes variáveis de ambiente devem ser configuradas:
```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=dona-lu-4242d.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=dona-lu-4242d
VITE_FIREBASE_STORAGE_BUCKET=dona-lu-4242d.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=1:...
VITE_API_BASE_URL=https://donalupastel-main.vercel.app  # URL das funções de backend em produção
VITE_GOOGLE_PAY_ENVIRONMENT=TEST
VITE_GOOGLE_PAY_GATEWAY=example
VITE_GOOGLE_PAY_MERCHANT_ID=...
VITE_PAGSEG_MERCHANT_ID=...
```

---

## ⚡ Regras de Desenvolvimento e Diretrizes para LLMs

1. **Alterações de Tela/View:** O roteamento de telas da SPA é feito alterando o estado `activeView` no [App.tsx](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/App.tsx). Para adicionar uma nova tela, registre um novo ID no `menuItems` (com as respectivas regras de acesso por role) e renderize o componente dinamicamente dentro do bloco `<Suspense>` no corpo principal do layout do arquivo.
2. **Atualização da Documentação:** Ao criar novas tabelas no banco de dados Firestore, adicionar campos em `user.ts` ou `order.ts`, criar novos endpoints na pasta `/api` ou novos utilitários na pasta `/src/utils`, **você deve atualizar esta documentação imediatamente** no final da sua tarefa para manter o histórico alinhado e economizar tokens nas próximas iterações.
3. **Padrão de Cores e Estilos:** Não use cores genéricas. Todos os estilos devem seguir o padrão dourado/vermelho/escuro premium definido pelas variáveis CSS de cores no [index.css](file:///e:/REPOSITORIOS%20-%20PROJETOS/DONA-LU-PASTELARIA/src/index.css).
