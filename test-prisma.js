import prisma from './src/lib/db.js';

async function test() {
  try {
    const res = await prisma.building.findFirst();
    console.log('Success:', res);
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
