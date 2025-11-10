export default function applyCors(req, res) {
	const allowedOrigins = [
		"https://home-nest-admin.vercel.app",
		"https://home-nest.vercel.app",
		"http://localhost:5173",
		"http://localhost:5174",
		"http://localhost:4173/",
	];

	const origin = req.headers.origin;

	if (allowedOrigins.includes(origin) ) {
		res.setHeader('Access-Control-Allow-Origin', origin);
	}
	
	req.setHeader("Access-Control-Allow-Credentials", "true");
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

	if (req.method === 'OPTIONS') {
		res.status(200).end();
		return true;
	}

	return false;
}