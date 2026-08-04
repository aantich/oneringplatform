import { Injectable, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PlatformState } from './domain.js';
import { createSeedState } from './seed.js';

@Injectable()
export class StoreService implements OnModuleInit {
  private state: PlatformState = createSeedState();
  private readonly dataFile = process.env.DATA_FILE ?? path.join(process.cwd(), '.data', 'state.json');
  private writeQueue = Promise.resolve();

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      this.state = JSON.parse(await readFile(this.dataFile, 'utf8')) as PlatformState;
      this.state.agents = this.state.agents.map((agent) => ({ ...agent, effort: agent.effort ?? 'medium' }));
    } catch {
      await this.persist();
    }
  }

  snapshot(): PlatformState {
    return structuredClone(this.state);
  }

  mutate(mutator: (state: PlatformState) => void): PlatformState {
    mutator(this.state);
    void this.persist();
    return this.snapshot();
  }

  reset(): void {
    this.state = createSeedState();
  }

  private async persist(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    const payload = JSON.stringify(this.state, null, 2);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.dataFile), { recursive: true });
      const temporary = `${this.dataFile}.tmp`;
      await writeFile(temporary, payload, { mode: 0o600 });
      await rename(temporary, this.dataFile);
    });
    await this.writeQueue;
  }
}
