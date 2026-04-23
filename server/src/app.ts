import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/api.routes';
import debugRoutes from './routes/debug.routes';
// You could import audioStream routes here if needed, but it seems it's currently unused or separate in the original index.ts
// Original index.ts didn't mount audioStream routes.

const app = express();

app.use(cors());
app.use(express.json());

// ── Health check ──
app.get('/health', (req, res) => res.send({ status: 'active', engine: 'EchoMind Neural Loop', ip: '192.168.29.113' }));

// ── Mount Routes ──
app.use('/api', apiRoutes);
app.use('/', debugRoutes);

export default app;
