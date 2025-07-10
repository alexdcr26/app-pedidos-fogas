/**
 * ARQUIVO: netlify/functions/enviar-alertas.js
 * Este é o código adaptado para rodar como uma Netlify Function.
 */

// Importa as bibliotecas necessárias.
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

// --- Configuração do Firebase Admin ---
// As credenciais são carregadas de forma segura a partir das variáveis de ambiente do Netlify.
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
};

// Inicializa o Firebase Admin apenas uma vez para evitar múltiplas instâncias.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

// --- Configuração do Nodemailer ---
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER, // Seu e-mail do Gmail
        pass: process.env.GMAIL_APP_PASS    // Sua senha de app gerada pelo Google
    }
});

// --- Definição da Netlify Function ---
exports.handler = async function(event, context) {
    
    console.log("Função 'enviar-alertas' acionada. Iniciando verificação...");

    const db = admin.firestore();
    
    try {
        const pedidosSnapshot = await db.collectionGroup('pedidos').get();
        const colaboradoresSnapshot = await db.collectionGroup('colaboradores').get();

        const todosPedidos = pedidosSnapshot.docs.map(doc => doc.data());
        const todosColaboradores = colaboradoresSnapshot.docs.flatMap(doc => doc.data().items || []);

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const umaSemanaApos = new Date(hoje);
        umaSemanaApos.setDate(hoje.getDate() + 7);

        const pedidosAtrasados = todosPedidos.filter(p => p.statusNFFiscal !== 'Entregue' && p.dataVencimento && new Date(p.dataVencimento) < hoje);
        const pedidosPertoVencimento = todosPedidos.filter(p => p.statusNFFiscal !== 'Entregue' && p.dataVencimento && new Date(p.dataVencimento) >= hoje && new Date(p.dataVencimento) <= umaSemanaApos);

        const pendenciasPorColaborador = {};

        pedidosAtrasados.forEach(p => {
            const nome = p.nomeColaborador;
            if (!pendenciasPorColaborador[nome]) pendenciasPorColaborador[nome] = { atrasados: [], perto: [] };
            pendenciasPorColaborador[nome].atrasados.push(p);
        });

        pedidosPertoVencimento.forEach(p => {
            const nome = p.nomeColaborador;
            if (!pendenciasPorColaborador[nome]) pendenciasPorColaborador[nome] = { atrasados: [], perto: [] };
            pendenciasPorColaborador[nome].perto.push(p);
        });

        for (const nomeColaborador in pendenciasPorColaborador) {
            const colaborador = todosColaboradores.find(c => c.nome === nomeColaborador);
            
            if (colaborador && colaborador.email) {
                const pendencias = pendenciasPorColaborador[nomeColaborador];
                let corpoEmail = `<h1>Olá, ${nomeColaborador}!</h1><p>Você tem as seguintes pendências de pedidos no sistema:</p>`;
                
                if (pendencias.atrasados.length > 0) {
                    corpoEmail += "<h2>🚨 Pedidos Atrasados:</h2><ul>";
                    pendencias.atrasados.forEach(p => { corpoEmail += `<li>Pedido <strong>${p.numeroPedido}</strong> (${p.fornecedor})</li>`; });
                    corpoEmail += "</ul>";
                }

                if (pendencias.perto.length > 0) {
                    corpoEmail += "<h2>⚠️ Pedidos Perto do Vencimento:</h2><ul>";
                    pendencias.perto.forEach(p => { corpoEmail += `<li>Pedido <strong>${p.numeroPedido}</strong> (${p.fornecedor})</li>`; });
                    corpoEmail += "</ul>";
                }

                corpoEmail += "<p>Por favor, verifique o sistema para mais detalhes.</p>";

                const mailOptions = {
                    from: `"Sistema de Pedidos FOGÁS" <${process.env.GMAIL_USER}>`,
                    to: colaborador.email,
                    subject: "Alerta de Pendências de Pedidos",
                    html: corpoEmail
                };

                await transporter.sendMail(mailOptions);
                console.log(`Email de alerta enviado com sucesso para ${colaborador.email}`);
            }
        }

        console.log("Verificação de pedidos concluída com sucesso.");
        return {
            statusCode: 200,
            body: "Processo de verificação e envio de e-mails concluído."
        };

    } catch (error) {
        console.error("Erro ao executar a função de envio de alertas:", error);
        return {
            statusCode: 500,
            body: "Ocorreu um erro no servidor."
        };
    }
};
