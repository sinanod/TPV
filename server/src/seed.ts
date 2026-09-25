import { prisma } from "./db";

async function main() {
  await prisma.orderLine.deleteMany();
  await prisma.order.deleteMany();
  await prisma.table.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.createMany({
    data: [
      { name: "Admin", pin: "0000", role: "ADMIN" },
      { name: "Ana", pin: "1111", role: "WAITER" },
      { name: "Luis", pin: "2222", role: "WAITER" },
      { name: "Cocina", pin: "9999", role: "KITCHEN" },
    ],
  });

  const interior = await prisma.zone.create({ data: { name: "Interior" } });
  const terraza = await prisma.zone.create({ data: { name: "Terraza" } });

  await prisma.table.createMany({
    data: [
      { number: 1, capacity: 2, zoneId: interior.id },
      { number: 2, capacity: 4, zoneId: interior.id },
      { number: 3, capacity: 4, zoneId: interior.id },
      { number: 4, capacity: 6, zoneId: interior.id },
      { number: 1, capacity: 4, zoneId: terraza.id },
      { number: 2, capacity: 4, zoneId: terraza.id },
    ],
  });

  const bebidas = await prisma.category.create({ data: { name: "Bebidas", printerTag: "BAR" } });
  const comida = await prisma.category.create({ data: { name: "Comida", printerTag: "KITCHEN" } });
  const postres = await prisma.category.create({ data: { name: "Postres", printerTag: "KITCHEN" } });

  await prisma.product.createMany({
    data: [
      { name: "Caña", price: 2.2, categoryId: bebidas.id },
      { name: "Agua", price: 1.5, categoryId: bebidas.id },
      { name: "Refresco", price: 2.5, categoryId: bebidas.id },
      { name: "Vino de la casa", price: 3.0, categoryId: bebidas.id },
      { name: "Patatas bravas", price: 6.5, categoryId: comida.id },
      { name: "Tortilla española", price: 7.0, categoryId: comida.id },
      { name: "Ensalada mixta", price: 8.5, categoryId: comida.id },
      { name: "Hamburguesa TPV", price: 11.0, categoryId: comida.id },
      { name: "Tarta de queso", price: 4.5, categoryId: postres.id },
      { name: "Flan casero", price: 3.5, categoryId: postres.id },
    ],
  });

  console.log("Datos de demo creados: usuarios (PIN 0000/1111/2222/9999), mesas, y catálogo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
