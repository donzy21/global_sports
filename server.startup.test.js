const request = require('supertest');

describe('server startup safety', () => {
  let app;

  beforeAll(() => {
    jest.resetModules();
    ({ app } = require('./server'));
  });

  test('loads server module without startup reference errors', () => {
    expect(app).toBeDefined();
  });

  test.each(['/health', '/api/health'])('exposes %s endpoint', async (endpoint) => {
    const response = await request(app).get(endpoint);
    expect([200, 503]).toContain(response.status);
    expect(response.body).toMatchObject({ service: 'global-sports-backend' });
  });
});
