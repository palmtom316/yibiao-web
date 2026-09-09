import type { FastifyInstance } from 'fastify';
import { LOCAL_SUPPORTED_EXTENSIONS } from '../document/parser';
import { registerImportJob, startImport } from '../document/imports';
import type { JobService } from '../jobs/service';
export async function documentRoutes(app: FastifyInstance) {
  registerImportJob((app as unknown as { jobs: JobService }).jobs, 'parse-upload', async (_projectId, docs) => ({ ...docs[0], documents: docs }));
  app.get('/documents/supported-extensions', async () => ({ extensions: [...LOCAL_SUPPORTED_EXTENSIONS] }));
  app.post('/documents/parse', async (req, reply) => reply.code(202).send(await startImport(req, 'parse-upload')));
}
