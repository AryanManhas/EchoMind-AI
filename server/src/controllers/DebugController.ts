import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { extractContext } from '../services/gemini.service';

export class DebugController {
  async debugDb(req: Request, res: Response): Promise<void> {
    try {
      const data = await prisma.memory.findMany({ take: 5 });
      res.json({ success: true, data });
    } catch (err: any) {
      res.json({ success: false, error: err.message });
    }
  }

  async debugContext(req: Request, res: Response): Promise<void> {
    const { text } = req.body;
    const result = await extractContext(text);
    res.json(result);
  }
}
