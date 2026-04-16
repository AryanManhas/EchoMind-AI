import * as dotenv from 'dotenv';
dotenv.config();
import prisma from '../src/lib/prisma';

const sampleMemories = [
  {
    title: 'Research Neural Interfaces',
    summary: 'Explored the latest advancements in brain-computer interfaces to enhance high-bandwidth human-to-AI data transfer.',
    category: 'Idea',
    importance: 0.95,
    rawTranscript: 'I was thinking about how we can improve bandwidth between humans and AI. The latest Neuralink papers suggest we should investigate deeper cortical node architectures.',
    nextActionDate: new Date(Date.now() + 86400000)
  },
  {
    title: 'Update Docker Configuration',
    summary: 'Need to restructure the multi-stage Dockerfile to leverage node:20-slim and strip out unnecessary devDependencies for production.',
    category: 'Task',
    importance: 0.8,
    rawTranscript: 'Remind me tomorrow to fix the backend dockerfile, it needs to use node 20 slim and multi stage builds to cut down the final image size.',
    nextActionDate: new Date(Date.now() + 86400000)
  },
  {
    title: 'React 19 Hooks Evolution',
    summary: 'Fact: useActionState and useFormStatus are becoming standard replacements for legacy form processing in React.',
    category: 'Fact',
    importance: 0.6,
    rawTranscript: 'I learned today that React 19 is pushing use action state and use form status really hard. It essentially deprecates how we used to handle forms locally.',
  },
  {
    title: 'Optimize Expo EAS Build',
    summary: 'The mobile team outlined requirements for switching to internal distribution channels on the preview build to test native module integrations.',
    category: 'Task',
    importance: 0.75,
    rawTranscript: 'We need to optimize the eas json configuration so we distribute internally for preview builds before hitting production.',
  },
  {
    title: 'Pino Telemetry Rollout',
    summary: 'Integrated structured JSON logging across the Node environment to capture latency telemetry points.',
    category: 'Fact',
    importance: 0.5,
    rawTranscript: 'We finally deployed pino for telemetry in the backend. It captures all the latency stats for the audit logs.',
  },
  {
    title: 'Pitch Deck Revision',
    summary: 'Sync with the design team to ensure our pitch deck utilizes the new glassmorphism aesthetics defined in the UI spec.',
    category: 'Task',
    importance: 0.9,
    rawTranscript: 'I need to talk to design to change the pitch deck so it matches the new glassmorphism ui specs we agreed on.',
    nextActionDate: new Date(Date.now() + 172800000)
  }
];

async function main() {
  console.log('Seeding EchoMind Database...');
  
  // Wipe existing for pristine demo env (optional)
  await prisma.memory.deleteMany();

  for (const memory of sampleMemories) {
    await prisma.memory.create({
      data: memory
    });
  }
  
  console.log('Seeding successful. Inserted 6 memories.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
