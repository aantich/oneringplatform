import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { BrowserAppRepository } from './browser-app.repository.js';
import { loadPlatformEnvironment } from './environment.js';

loadPlatformEnvironment();

async function bootstrap(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    for (const name of ['RUNTIME_SESSION_SECRET', 'CONTROL_PLANE_JWT_SECRET', 'IDENTITY_EXCHANGE_SECRET']) {
      if (!process.env[name] || process.env[name]!.length < 32) throw new Error(`${name} must be configured with at least 32 characters`);
    }
  }
  const app = await NestFactory.create(AppModule, { cors: false });
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'apps', method: RequestMethod.ALL },
      { path: 'apps/*path', method: RequestMethod.ALL },
    ],
  });
  const browserApps = app.get(BrowserAppRepository);
  app.use(async (req: { hostname?: string; headers: Record<string, string | string[] | undefined>; path: string; url: string }, _res: unknown, next: (error?: unknown) => void) => {
    try {
      delete req.headers['x-onering-route-base'];
      const hostname = (req.hostname ?? String(req.headers.host ?? '').split(':')[0] ?? '').toLowerCase();
      const platformHosts = new Set((process.env.PLATFORM_HOSTS ?? 'localhost,127.0.0.1').split(',').map((host) => host.trim().toLowerCase()));
      if (!platformHosts.has(hostname) && !req.path.startsWith('/api') && !req.path.startsWith('/apps/')) {
        const resolved = await browserApps.resolveBinding(hostname, req.path);
        if (resolved && resolved.binding.type !== 'platform_path') {
          req.headers['x-onering-route-base'] = 'root';
          req.url = `/apps/${encodeURIComponent(resolved.app.publicKey)}${req.url === '/' ? '' : req.url}`;
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 4100);
  await app.listen(port, '127.0.0.1');
  console.log(`One Ring Platform API listening on http://127.0.0.1:${port}/api`);
}

void bootstrap();
