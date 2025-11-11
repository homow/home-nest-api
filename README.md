# 🏠 Home Nest API

**Home Nest API** is a lightweight serverless backend built specifically for the
[`home-nest`](https://github.com/homow/home-nest) and [`home-nest-admin`](https://github.com/homow/home-nest-admin) projects.
It runs entirely on [Vercel Serverless Functions](https://vercel.com/docs/functions) using pure **Node.js** (no frameworks).

---

## 🚀 Overview

This API provides the backend logic and endpoints required by both **Home Nest** (the client-facing app) and **Home Nest Admin** (the management panel).

All routes are implemented as serverless functions under the `/api` directory — fully isolated, fast, and scalable.

---

## 🧩 Features

* 🧠 Pure **Node.js** serverless functions (no Express or frameworks)
* ⚡ Hosted and auto-deployed on **Vercel**
* 🔐 Secure endpoints with **Bearer token authentication**
* 🗂️ JSON-based APIs for CRUD operations
* 🪶 Lightweight and minimal dependencies
* 🧱 **Supabase integration** for database, authentication, and file storage

---

## 🗄️ Supabase

**Supabase** is used as the main backend service provider.
It handles:

* 🧩 Database (PostgreSQL)
* 🔑 Authentication (JWT)
* 🖼️ Storage (images, media, and files)
* ⚙️ Admin-level service keys for server-side operations

You can configure it using environment variables:

```
SUPABASE_URL=<your_supabase_url>
SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>
SUPABASE_ANON_KEY=<your_anon_key>
```

---

## 📁 Structure

```
home-nest-api/
│
├── api/
│   ├── auth/                # Handle auth login, logout, refresh and signup
│   ├── config               # initial supabase and headers config
│   ├── properties.js        # Handle property CRUD
│   └── ...                  # Other API routes
│
├── docs/
│   ├── endpoints/           # Documentation for endpoints and request examples
│   └── functions/           # Documentation for serverless functions
│
└── vercel.json              # Routing and rewrite rules
```
---

## 🧰 Installation & Setup

Clone the repository and install dependencies locally:

```bash
# Clone the repository
git clone https://github.com/homow/home-nest-api.git

# Navigate to the project directory
cd home-nest-api

# Install dependencies
npm install
```

To run it locally with Vercel’s dev environment:

```bash
vercel dev
```

---

## ⚙️ Deployment

Deployment is handled automatically through **GitHub Actions** using the **Vercel CLI**.
When you push to the `main` branch, the workflow deploys the latest version to production:

```yaml
vercel --prod --token $VERCEL_TOKEN --yes
```

---

## 🌍 Routing Example

All client-side requests from both `home-nest` and `home-nest-admin` are proxied through:

```
https://home-nest-api.vercel.app/api/<endpoint>
```

Example:

```
GET https://home-nest-api.vercel.app/api/properties?id=1234
```

---

## 🛠️ Rewrites (vercel.json)

```json
{
  "project": "home-nest-api",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://home-nest-api.vercel.app/api/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

---

## 🧑‍💻 Author

Developed and maintained by **[homow](https://github.com/homow)**.