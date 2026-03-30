module.exports = {
  apps: [
    {
      name: 'openinvoice-api',
      cwd: './backend',
      script: '.venv/bin/uvicorn',
      args: 'main:app --host 0.0.0.0 --port 5023',
      interpreter: 'none',
      env: {
        MINIMAX_API_KEY: '',
        CLERK_SECRET_KEY: '',
        CLERK_JWKS_URL: '',
      },
    },
    {
      name: 'openinvoice-web',
      cwd: './frontend',
      script: 'npx',
      args: 'vite --port 3023 --host 0.0.0.0',
      env: {
        VITE_CLERK_PUBLISHABLE_KEY: '',
      },
    },
  ],
};
