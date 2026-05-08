/**
 * ============================================
 *  PROWPP — Bot WhatsApp (Twilio + Infobip)
 * ============================================
 */
const express = require('express');
const axios = require('axios');
const twilio = require('twilio');
const db = require('../database');
const router = express.Router();

// ── Twilio ───────────────────────────────────
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM  = process.env.TWILIO_WHATSAPP_FROM;

// ── Infobip ──────────────────────────────────
const INFOBIP_KEY  = process.env.INFOBIP_API_KEY;
const INFOBIP_URL  = `https://${process.env.INFOBIP_BASE_URL}`;
const INFOBIP_FROM = process.env.INFOBIP_WHATSAPP_FROM;

// ── Enviar mensaje (Twilio) ──────────────────
async function sendTwilio(to, text) {
  try {
    await twilioClient.messages.create({
      from: TWILIO_FROM,
      to: `whatsapp:${to}`,
      body: text,
    });
  } catch (err) {
    console.error('Error Twilio:', err.message);
  }
}

// ── Enviar mensaje (Infobip) ─────────────────
async function sendInfobip(to, text) {
  try {
    await axios.post(
      `${INFOBIP_URL}/whatsapp/1/message/text`,
      { from: INFOBIP_FROM, to, content: { text } },
      { headers: { Authorization: `App ${INFOBIP_KEY}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Error Infobip:', err?.response?.data || err.message);
  }
}

// ── WEBHOOK TWILIO ───────────────────────────
router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  res.sendStatus(200);

  const from     = (req.body.From || '').replace('whatsapp:', '');
  const body     = (req.body.Body || '').trim();
  const mediaUrl = req.body.MediaUrl0;

  await procesarMensaje(from, body, mediaUrl ? 'IMAGE' : 'TEXT', null, (to, text) => sendTwilio(to, text));
});

// ── WEBHOOK INFOBIP ──────────────────────────
router.post('/webhook-infobip', express.json(), async (req, res) => {
  res.sendStatus(200);

  const results = req.body?.results;
  if (!results?.length) return;

  for (const msg of results) {
    const from     = msg.from;
    const type     = msg.message?.type || 'TEXT';
    const body     = (msg.message?.text || '').trim();
    const audioUrl = msg.message?.url;

    await procesarMensaje(from, body, type, audioUrl, (to, text) => sendInfobip(to, text));
  }
});

// ── LÓGICA PRINCIPAL ─────────────────────────
async function procesarMensaje(from, body, type, audioUrl, send) {
  try {
    const jefe = await db.getUserByPhone(from);
    if (jefe) {
      await handleJefe(from, jefe, type, body, audioUrl, send);
      return;
    }

    const worker = await db.getWorkerByPhone(from);
    if (!worker) {
      await send(from, '❌ Tu número no está registrado.\nContacta con tu empresa para que te den de alta.');
      return;
    }

    const company = await db.getCompanyById(worker.company_id);
    await handleWorker(from, worker, company, type, body, send);

  } catch (err) {
    console.error('Error procesando mensaje:', err);
    await send(from, '⚠️ Error interno. Inténtalo de nuevo.');
  }
}

// ── HANDLER TRABAJADOR ───────────────────────
async function handleWorker(from, worker, company, type, body, send) {
  let reply = '';

  if (type === 'IMAGE' || type === 'DOCUMENT') {
    reply = '📸 Imagen recibida.\n\nUsa *gasto [importe] [descripción]* para registrar manualmente.\n_Ej: gasto 45.50 gasolina_';
  } else if (type === 'AUDIO') {
    reply = '🎤 Los mensajes de voz solo están disponibles para administradores.';
  } else if (/^fichar/i.test(body)) {
    reply = await handleFichaje(worker, body);
  } else if (/^gasto/i.test(body)) {
    reply = await handleGasto(worker, body);
  } else if (/mis horas|ver horas|horas/i.test(body)) {
    reply = await handleMisHoras(worker);
  } else if (/mis gastos|ver gastos|gastos/i.test(body)) {
    reply = await handleMisGastos(worker);
  } else if (/ayuda|help|hola|inicio|menu|menú/i.test(body)) {
    reply = mensajeAyudaWorker(worker, company);
  } else {
    reply = '❓ No entendí el mensaje.\n\nEscribe *ayuda* para ver los comandos.';
  }

  await send(from, reply);
}

// ── HANDLER JEFE ─────────────────────────────
async function handleJefe(from, jefe, type, body, audioUrl, send) {
  let reply = '';

  if (type === 'AUDIO') {
    reply = await handleFacturaVoz(jefe, audioUrl);
  } else if (/^equipo/i.test(body)) {
    reply = await handleEstadoEquipo(jefe);
  } else if (/^fichajes hoy/i.test(body)) {
    reply = await handleFichajesHoy(jefe);
  } else if (/^fichajes semana/i.test(body)) {
    reply = await handleFichajesSemana(jefe);
  } else if (/^gastos mes/i.test(body)) {
    reply = await handleGastosMes(jefe);
  } else {
    reply = mensajeAyudaJefe(jefe);
  }

  await send(from, reply);
}

// ── FUNCIONES TRABAJADOR ─────────────────────

async function handleFichaje(worker, body) {
  const esSalida = /salida/i.test(body);
  let lugar = body.replace(/^fichar\s*/i, '').replace(/^salida\s*/i, '').trim() || 'Sin especificar';
  const hora = new Date();
  const horaStr  = hora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const fechaStr = hora.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  const fichaje = await db.registrarFichaje({
    workerId: worker.id, companyId: worker.company_id,
    tipo: esSalida ? 'salida' : 'entrada', lugar, timestamp: hora,
  });

  let duracionTexto = '';
  if (esSalida && fichaje.duracionMinutos) {
    const h = Math.floor(fichaje.duracionMinutos / 60);
    const m = fichaje.duracionMinutos % 60;
    duracionTexto = `\n⏱ Jornada: *${h}h ${m}m*`;
  }

  return (
    `${esSalida ? '🚪' : '⏱'} *${esSalida ? 'Salida' : 'Entrada'} registrada*\n\n` +
    `👷 ${worker.nombre}\n` +
    `📍 Lugar: *${lugar}*\n` +
    `🕐 Hora: *${horaStr}*\n` +
    `📅 ${fechaStr}` +
    duracionTexto +
    `\n\n✅ Registrado correctamente.`
  );
}

async function handleGasto(worker, body) {
  const partes = body.replace(/^gasto\s*/i, '').trim().split(/\s+/);
  const importe = parseFloat(partes[0]);
  const descripcion = partes.slice(1).join(' ') || 'Sin descripción';

  if (isNaN(importe) || importe <= 0) {
    return '❌ Formato incorrecto.\n\nUsa: *gasto [importe] [descripción]*\nEj: *gasto 45.50 gasolina*';
  }

  await db.registrarGasto({
    workerId: worker.id, companyId: worker.company_id,
    importe, descripcion, fotoUrl: null, timestamp: new Date(),
  });

  return (
    `💶 *Gasto registrado*\n\n` +
    `👷 ${worker.nombre}\n` +
    `💰 Importe: *${importe.toFixed(2)}€*\n` +
    `📝 Concepto: *${descripcion}*\n\n` +
    `✅ Pendiente de verificación.`
  );
}

async function handleMisHoras(worker) {
  const resumen = await db.getResumenHoras(worker.id);
  let texto = `📋 *Tus horas — ${worker.nombre}*\n\n`;
  if (!resumen.dias.length) {
    texto += 'No hay fichajes esta semana.\n';
  } else {
    resumen.dias.forEach(d => {
      texto += `${d.dia}: *${d.horas}h ${d.minutos}m*`;
      if (d.lugar) texto += ` · ${d.lugar}`;
      texto += '\n';
    });
  }
  texto += `\n⏱ Total semana: *${resumen.totalHoras}h ${resumen.totalMinutos}m*`;
  return texto;
}

async function handleMisGastos(worker) {
  const gastos = await db.getGastosByWorker(worker.id);
  if (!gastos.length) return '💶 No tienes gastos registrados este mes.';
  const total = gastos.reduce((s, g) => s + Number(g.importe), 0);
  let texto = `💶 *Tus gastos — mes actual*\n\n`;
  gastos.forEach(g => {
    const estado = g.estado === 'verificado' ? '✅' : g.estado === 'rechazado' ? '❌' : '⏳';
    texto += `${estado} ${g.descripcion}: *${Number(g.importe).toFixed(2)}€*\n`;
  });
  texto += `\n💰 Total: *${total.toFixed(2)}€*`;
  return texto;
}

function mensajeAyudaWorker(worker, company) {
  return (
    `👋 *Hola, ${worker.nombre}!*\n` +
    `🏢 ${company ? company.nombre : 'Tu empresa'}\n\n` +
    `*Comandos disponibles:*\n\n` +
    `⏱ *fichar [lugar]* — registra tu entrada\n` +
    `   _Ej: fichar Madrid centro_\n\n` +
    `🚪 *fichar salida [lugar]* — registra tu salida\n` +
    `   _Ej: fichar salida Getafe_\n\n` +
    `💶 *gasto [€] [concepto]* — registra un gasto\n` +
    `   _Ej: gasto 45.50 gasolina_\n\n` +
    `📋 *mis horas* — ver horas esta semana\n\n` +
    `💰 *mis gastos* — ver gastos del mes`
  );
}

// ── FUNCIONES JEFE ───────────────────────────

async function handleEstadoEquipo(jefe) {
  const equipo = await db.getEstadoEquipo(jefe.company_id);
  if (!equipo.length) return '👥 No tienes trabajadores.\n\nAñádelos desde el panel web.';
  let texto = `👥 *Estado del equipo — ahora*\n\n`;
  equipo.forEach(w => {
    const icono = w.estado === 'dentro' ? '🟢' : w.estado === 'fuera' ? '🔴' : '⚪';
    texto += `${icono} *${w.nombre}*`;
    if (w.ultimoFichaje) {
      const hora = new Date(w.ultimoFichaje.hora).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      texto += ` — ${w.estado === 'dentro' ? 'Entrada' : 'Salida'} ${hora}`;
      if (w.ultimoFichaje.lugar) texto += ` · ${w.ultimoFichaje.lugar}`;
    } else {
      texto += ` — Sin fichar hoy`;
    }
    texto += '\n';
  });
  return texto;
}

async function handleFichajesHoy(jefe) {
  const fichajes = await db.getFichajesByCompany(jefe.company_id, 'hoy');
  if (!fichajes.length) return '📋 No hay fichajes hoy.';
  let texto = `📋 *Fichajes hoy*\n\n`;
  fichajes.forEach(f => {
    const hora = new Date(f.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    texto += `${f.tipo === 'entrada' ? '⏱' : '🚪'} ${f.nombre} — ${f.tipo} ${hora}`;
    if (f.lugar) texto += ` · ${f.lugar}`;
    texto += '\n';
  });
  return texto;
}

async function handleFichajesSemana(jefe) {
  const fichajes = await db.getFichajesByCompany(jefe.company_id, 'semana');
  if (!fichajes.length) return '📋 No hay fichajes esta semana.';
  let texto = `📋 *Fichajes esta semana*\n\n`;
  fichajes.slice(0, 20).forEach(f => {
    const fecha = new Date(f.timestamp).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
    const hora = new Date(f.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    texto += `${f.tipo === 'entrada' ? '⏱' : '🚪'} ${f.nombre} — ${fecha} ${hora}\n`;
  });
  if (fichajes.length > 20) texto += `\n_...y ${fichajes.length - 20} más. Ver panel web._`;
  return texto;
}

async function handleGastosMes(jefe) {
  const gastos = await db.getGastosByCompany(jefe.company_id);
  if (!gastos.length) return '💶 No hay gastos este mes.';
  const total = gastos.reduce((s, g) => s + Number(g.importe), 0);
  let texto = `💶 *Gastos del mes*\n\n`;
  gastos.slice(0, 15).forEach(g => {
    const estado = g.estado === 'verificado' ? '✅' : g.estado === 'rechazado' ? '❌' : '⏳';
    texto += `${estado} ${g.nombre}: ${g.descripcion} — *${Number(g.importe).toFixed(2)}€*\n`;
  });
  texto += `\n💰 Total: *${total.toFixed(2)}€*`;
  return texto;
}

async function handleFacturaVoz(jefe, audioUrl) {
  return (
    `🎤 *Audio recibido*\n\n` +
    `⏳ La generación de facturas por voz estará disponible próximamente.\n\n` +
    `Por ahora genera tus facturas desde el panel web en prowpp.com`
  );
}

function mensajeAyudaJefe(jefe) {
  return (
    `👋 *Hola, ${jefe.nombre}!*\n` +
    `🏢 Panel de administrador\n\n` +
    `*Comandos:*\n\n` +
    `👥 *equipo* — estado del equipo ahora\n` +
    `📋 *fichajes hoy* — fichajes de hoy\n` +
    `📋 *fichajes semana* — fichajes de la semana\n` +
    `💶 *gastos mes* — gastos del mes\n` +
    `🎤 *Mensaje de voz* — generar factura (próx.)\n\n` +
    `🌐 Panel: prowpp.com`
  );
}

module.exports = router;
