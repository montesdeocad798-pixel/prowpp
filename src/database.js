require('dotenv').config();
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: './prowpp.db' },
  useNullAsDefault: true,
});

async function init() {
  // empresas
  if (!await knex.schema.hasTable('companies')) {
    await knex.schema.createTable('companies', t => {
      t.increments('id').primary();
      t.string('nombre').notNullable();
      t.string('sector').defaultTo('construcción');
      t.enum('plan', ['basico', 'pro']).defaultTo('basico');
      t.boolean('activo').defaultTo(true);
      t.timestamps(true, true);
    });
    console.log('✅ Tabla companies creada');
  }

  // usuarios (jefes + super admin)
  if (!await knex.schema.hasTable('users')) {
    await knex.schema.createTable('users', t => {
      t.increments('id').primary();
      t.string('nombre').notNullable();
      t.string('email').unique().notNullable();
      t.string('password').notNullable();
      t.string('telefono').nullable();
      t.enum('rol', ['superadmin', 'jefe']).defaultTo('jefe');
      t.integer('company_id').references('companies.id').nullable();
      t.boolean('activo').defaultTo(true);
      t.timestamps(true, true);
    });

    // crear super admin David
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'prowpp2026', 10);
    await knex('users').insert({
      nombre: 'David Montesdeoca',
      email: process.env.ADMIN_EMAIL || 'montesdeocad798@gmail.com',
      password: hash,
      rol: 'superadmin',
      company_id: null,
    });
    console.log('✅ Tabla users creada + super admin creado');
  }

  // trabajadores
  if (!await knex.schema.hasTable('workers')) {
    await knex.schema.createTable('workers', t => {
      t.increments('id').primary();
      t.string('nombre').notNullable();
      t.string('telefono').notNullable();
      t.string('rol').defaultTo('Trabajador');
      t.integer('company_id').references('companies.id').notNullable();
      t.boolean('activo').defaultTo(true);
      t.timestamps(true, true);
    });
    console.log('✅ Tabla workers creada');
  }

  // fichajes
  if (!await knex.schema.hasTable('fichajes')) {
    await knex.schema.createTable('fichajes', t => {
      t.increments('id').primary();
      t.integer('worker_id').references('workers.id').notNullable();
      t.integer('company_id').references('companies.id').notNullable();
      t.enum('tipo', ['entrada', 'salida']).notNullable();
      t.string('lugar').defaultTo('Sin especificar');
      t.timestamp('timestamp').notNullable();
      t.integer('duracion_minutos').nullable();
      t.timestamps(true, true);
    });
    console.log('✅ Tabla fichajes creada');
  }

  // gastos
  if (!await knex.schema.hasTable('gastos')) {
    await knex.schema.createTable('gastos', t => {
      t.increments('id').primary();
      t.integer('worker_id').references('workers.id').notNullable();
      t.integer('company_id').references('companies.id').notNullable();
      t.decimal('importe', 8, 2).notNullable();
      t.string('descripcion');
      t.string('foto_url');
      t.enum('estado', ['pendiente', 'verificado', 'rechazado']).defaultTo('pendiente');
      t.timestamp('timestamp').notNullable();
      t.timestamps(true, true);
    });
    console.log('✅ Tabla gastos creada');
  }
}

// ── WORKERS ──────────────────────────────────
async function getWorkerByPhone(telefono) {
  return knex('workers').where({ telefono, activo: true }).first();
}
async function getWorkersByCompany(companyId) {
  return knex('workers').where({ company_id: companyId, activo: true }).orderBy('nombre');
}
async function createWorker({ nombre, telefono, rol, companyId }) {
  const [id] = await knex('workers').insert({ nombre, telefono, rol, company_id: companyId });
  return { id, nombre, telefono, rol };
}
async function deleteWorker(id) {
  return knex('workers').where({ id }).update({ activo: false });
}

// ── COMPANIES ────────────────────────────────
async function getAllCompanies() {
  return knex('companies').where({ activo: true }).orderBy('nombre');
}
async function createCompany({ nombre, sector }) {
  const [id] = await knex('companies').insert({ nombre, sector });
  return { id, nombre };
}
async function getCompanyById(id) {
  return knex('companies').where({ id }).first();
}

// ── USERS ────────────────────────────────────
async function getUserByEmail(email) {
  return knex('users').where({ email, activo: true }).first();
}
async function getUserByPhone(telefono) {
  return knex('users').where({ telefono, activo: true }).whereNot({ rol: 'superadmin' }).first();
}
async function createUser({ nombre, email, password, telefono, companyId }) {
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(password, 10);
  const [id] = await knex('users').insert({ nombre, email, password: hash, telefono: telefono || null, rol: 'jefe', company_id: companyId });
  return { id, nombre, email };
}
async function getAllUsers() {
  return knex('users').where({ activo: true }).whereNot({ rol: 'superadmin' })
    .join('companies', 'companies.id', 'users.company_id')
    .select('users.*', 'companies.nombre as empresa');
}

// ── FICHAJES ─────────────────────────────────
async function registrarFichaje({ workerId, companyId, tipo, lugar, timestamp }) {
  let duracionMinutos = null;
  if (tipo === 'salida') {
    const inicioDia = new Date(timestamp);
    inicioDia.setHours(0, 0, 0, 0);
    const ultimaEntrada = await knex('fichajes')
      .where({ worker_id: workerId, tipo: 'entrada' })
      .where('timestamp', '>=', inicioDia.toISOString())
      .orderBy('timestamp', 'desc').first();
    if (ultimaEntrada) {
      duracionMinutos = Math.floor((timestamp - new Date(ultimaEntrada.timestamp)) / 60000);
    }
  }
  const [id] = await knex('fichajes').insert({
    worker_id: workerId, company_id: companyId, tipo, lugar,
    timestamp: timestamp.toISOString(), duracion_minutos: duracionMinutos,
  });
  return { id, duracionMinutos };
}

async function getFichajesByCompany(companyId, periodo = 'hoy') {
  const ahora = new Date();
  let desde = new Date(ahora);
  if (periodo === 'semana') {
    desde.setDate(ahora.getDate() - ((ahora.getDay() + 6) % 7));
    desde.setHours(0, 0, 0, 0);
  } else {
    desde.setHours(0, 0, 0, 0);
  }
  return knex('fichajes')
    .join('workers', 'workers.id', 'fichajes.worker_id')
    .where('fichajes.company_id', companyId)
    .where('fichajes.timestamp', '>=', desde.toISOString())
    .select('workers.nombre', 'workers.rol', 'fichajes.tipo', 'fichajes.lugar', 'fichajes.timestamp', 'fichajes.duracion_minutos')
    .orderBy('fichajes.timestamp', 'desc');
}

async function getResumenHoras(workerId) {
  const hoy = new Date();
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  lunes.setHours(0, 0, 0, 0);
  const fichajes = await knex('fichajes')
    .where({ worker_id: workerId, tipo: 'salida' })
    .where('timestamp', '>=', lunes.toISOString())
    .whereNotNull('duracion_minutos').orderBy('timestamp');
  const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const diasMap = {};
  fichajes.forEach(f => {
    const idx = (new Date(f.timestamp).getDay() + 6) % 7;
    const key = DIAS[idx];
    if (!diasMap[key]) diasMap[key] = { minutos: 0, lugar: f.lugar };
    diasMap[key].minutos += f.duracion_minutos;
    diasMap[key].lugar = f.lugar;
  });
  const dias = Object.entries(diasMap).map(([dia, v]) => ({
    dia, horas: Math.floor(v.minutos / 60), minutos: v.minutos % 60, lugar: v.lugar,
  }));
  const totalMin = dias.reduce((s, d) => s + d.horas * 60 + d.minutos, 0);
  return { dias, totalHoras: Math.floor(totalMin / 60), totalMinutos: totalMin % 60 };
}

// ── GASTOS ───────────────────────────────────
async function registrarGasto({ workerId, companyId, importe, descripcion, fotoUrl, timestamp }) {
  const [id] = await knex('gastos').insert({
    worker_id: workerId, company_id: companyId, importe, descripcion,
    foto_url: fotoUrl, estado: 'pendiente', timestamp: timestamp.toISOString(),
  });
  return { id };
}

async function getGastosByCompany(companyId) {
  const inicio = new Date();
  inicio.setDate(1); inicio.setHours(0, 0, 0, 0);
  return knex('gastos')
    .join('workers', 'workers.id', 'gastos.worker_id')
    .where('gastos.company_id', companyId)
    .where('gastos.timestamp', '>=', inicio.toISOString())
    .select('workers.nombre', 'gastos.importe', 'gastos.descripcion', 'gastos.estado', 'gastos.timestamp')
    .orderBy('gastos.timestamp', 'desc');
}

async function getGastosByWorker(workerId) {
  const inicio = new Date();
  inicio.setDate(1); inicio.setHours(0, 0, 0, 0);
  return knex('gastos').where({ worker_id: workerId })
    .where('timestamp', '>=', inicio.toISOString()).orderBy('timestamp', 'desc');
}

// ── ESTADO EQUIPO ────────────────────────────
async function getEstadoEquipo(companyId) {
  const workers = await getWorkersByCompany(companyId);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Promise.all(workers.map(async w => {
    const ultimo = await knex('fichajes')
      .where({ worker_id: w.id })
      .where('timestamp', '>=', hoy.toISOString())
      .orderBy('timestamp', 'desc').first();
    return {
      id: w.id, nombre: w.nombre, rol: w.rol,
      estado: ultimo ? (ultimo.tipo === 'entrada' ? 'dentro' : 'fuera') : 'sin_fichar',
      ultimoFichaje: ultimo ? { tipo: ultimo.tipo, hora: ultimo.timestamp, lugar: ultimo.lugar } : null,
    };
  }));
}

module.exports = {
  init, knex,
  getWorkerByPhone, getWorkersByCompany, createWorker, deleteWorker,
  getAllCompanies, createCompany, getCompanyById,
  getUserByEmail, getUserByPhone, createUser, getAllUsers,
  registrarFichaje, getFichajesByCompany, getResumenHoras,
  registrarGasto, getGastosByCompany, getGastosByWorker,
  getEstadoEquipo,
};
