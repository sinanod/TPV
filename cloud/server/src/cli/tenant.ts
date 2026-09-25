import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { hashPassword } from "../auth";

// Alta y gestión de restaurantes. Solo la usa el operador de la plataforma;
// no existe registro público.
//
//   npm run tenant -- create --name "Bar Pepe" --username barpepe [--password X] [--admin-pin 0000] [--demo]
//   npm run tenant -- list
//   npm run tenant -- set-password --username barpepe [--password X]
//   npm run tenant -- disable --username barpepe
//   npm run tenant -- enable --username barpepe
//
// En producción (imagen Docker): node dist/cli/tenant.js <comando> ...

type Args = Record<string, string | true>;

function parseArgs(argv: string[]): { command: string | undefined; args: Args } {
  const [command, ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return { command, args };
}

function requireString(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Falta --${key}`);
  }
  return value.trim();
}

function randomPassword() {
  // Sin caracteres ambiguos (0/O, 1/l/I) para dictarla por teléfono
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 14 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
}

async function seedDemoConfig(tenantId: string) {
  const interior = await prisma.zone.create({ data: { tenantId, name: "Interior", sortOrder: 0 } });
  const terraza = await prisma.zone.create({ data: { tenantId, name: "Terraza", sortOrder: 1 } });
  await prisma.diningTable.createMany({
    data: [
      { tenantId, zoneId: interior.id, number: 1, capacity: 2 },
      { tenantId, zoneId: interior.id, number: 2, capacity: 4 },
      { tenantId, zoneId: interior.id, number: 3, capacity: 4 },
      { tenantId, zoneId: interior.id, number: 4, capacity: 6 },
      { tenantId, zoneId: terraza.id, number: 1, capacity: 4 },
      { tenantId, zoneId: terraza.id, number: 2, capacity: 4 },
    ],
  });

  const bebidas = await prisma.category.create({ data: { tenantId, name: "Bebidas", printerTag: "BAR", sortOrder: 0 } });
  const comida = await prisma.category.create({ data: { tenantId, name: "Comida", printerTag: "KITCHEN", sortOrder: 1 } });
  const postres = await prisma.category.create({ data: { tenantId, name: "Postres", printerTag: "KITCHEN", sortOrder: 2 } });
  await prisma.product.createMany({
    data: [
      { tenantId, categoryId: bebidas.id, name: "Caña", price: 2.2 },
      { tenantId, categoryId: bebidas.id, name: "Agua", price: 1.5 },
      { tenantId, categoryId: bebidas.id, name: "Refresco", price: 2.5 },
      { tenantId, categoryId: bebidas.id, name: "Vino de la casa", price: 3.0 },
      { tenantId, categoryId: comida.id, name: "Patatas bravas", price: 6.5 },
      { tenantId, categoryId: comida.id, name: "Tortilla española", price: 7.0 },
      { tenantId, categoryId: comida.id, name: "Ensalada mixta", price: 8.5 },
      { tenantId, categoryId: comida.id, name: "Hamburguesa", price: 11.0 },
      { tenantId, categoryId: postres.id, name: "Tarta de queso", price: 4.5 },
      { tenantId, categoryId: postres.id, name: "Flan casero", price: 3.5 },
    ],
  });

  await prisma.staff.createMany({
    data: [
      { tenantId, name: "Ana", pin: "1111", role: "WAITER" },
      { tenantId, name: "Luis", pin: "2222", role: "WAITER" },
      { tenantId, name: "Cocina", pin: "9999", role: "KITCHEN" },
    ],
  });
}

async function create(args: Args) {
  const name = requireString(args, "name");
  const username = requireString(args, "username").toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    throw new Error("El usuario debe tener 3-40 caracteres: letras minúsculas, números, punto, guion o guion bajo");
  }
  const password = typeof args.password === "string" ? args.password : randomPassword();
  if (password.length < 10) throw new Error("La contraseña debe tener al menos 10 caracteres");
  const adminPin = typeof args["admin-pin"] === "string" ? args["admin-pin"] : "0000";
  if (!/^\d{4,6}$/.test(adminPin)) throw new Error("El PIN de encargado debe tener entre 4 y 6 dígitos");

  const tenant = await prisma.tenant.create({
    data: {
      name,
      username,
      passwordHash: await hashPassword(password),
      // Un encargado inicial: sin él nadie podría entrar al TPV local tras vincularlo.
      staff: { create: { name: "Encargado", pin: adminPin, role: "ADMIN" } },
    },
  });
  if (args.demo) await seedDemoConfig(tenant.id);

  console.log("Restaurante creado:");
  console.log(`  Nombre:      ${tenant.name}`);
  console.log(`  Usuario:     ${tenant.username}`);
  console.log(`  Contraseña:  ${password}`);
  console.log(`  PIN encargado (TPV local): ${adminPin}`);
  if (args.demo) console.log("  Con carta, mesas y personal de demostración.");
  console.log("Entrega estas credenciales al restaurante por un canal seguro; la contraseña no se vuelve a mostrar.");
}

async function list() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { devices: { where: { revokedAt: null } } } } },
  });
  if (!tenants.length) {
    console.log("No hay restaurantes dados de alta.");
    return;
  }
  for (const t of tenants) {
    console.log(
      `${t.active ? "activo  " : "INACTIVO"}  ${t.username.padEnd(20)} ${t.name.padEnd(30)} dispositivos: ${t._count.devices}`,
    );
  }
}

async function setPassword(args: Args) {
  const username = requireString(args, "username").toLowerCase();
  const password = typeof args.password === "string" ? args.password : randomPassword();
  if (password.length < 10) throw new Error("La contraseña debe tener al menos 10 caracteres");
  await prisma.tenant.update({ where: { username }, data: { passwordHash: await hashPassword(password) } });
  console.log(`Nueva contraseña para ${username}: ${password}`);
  console.log("Los servidores locales ya vinculados siguen funcionando (usan su propio token).");
}

async function setActive(args: Args, active: boolean) {
  const username = requireString(args, "username").toLowerCase();
  await prisma.tenant.update({ where: { username }, data: { active } });
  console.log(`${username} ${active ? "activado" : "desactivado: no podrá entrar al portal ni sincronizar"}.`);
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "create":
      return create(args);
    case "list":
      return list();
    case "set-password":
      return setPassword(args);
    case "disable":
      return setActive(args, false);
    case "enable":
      return setActive(args, true);
    default:
      console.log("Uso: tenant <create|list|set-password|disable|enable> [opciones]");
      console.log('  create --name "Bar Pepe" --username barpepe [--password X] [--admin-pin 0000] [--demo]');
      process.exitCode = 1;
  }
}

function describeError(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return "Ya existe un restaurante con ese usuario";
    if (e.code === "P2025") return "No existe ningún restaurante con ese usuario";
  }
  return e instanceof Error ? e.message : String(e);
}

main()
  .catch((e) => {
    console.error(`Error: ${describeError(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
