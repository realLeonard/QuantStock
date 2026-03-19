import 'dotenv/config';
import { fetchList } from './fetcher.js';

const data = await fetchList(1, 20);
const official = data.result.filter((i: any) => i.author === null || i.author === '');
console.log(JSON.stringify(official.slice(0, 3), null, 2));
