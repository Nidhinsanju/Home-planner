import { HuggingFaceProvider } from './src/ai/planner';

async function test() {
  const provider = new HuggingFaceProvider();
  try {
    const res = await provider.generateResponse({
      projectId: '123',
      message: 'Add a living room',
      context: { rooms: [] }
    });
    console.log(res);
  } catch (err) {
    console.error(err);
  }
}

test();
