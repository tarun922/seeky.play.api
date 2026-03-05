// config.js — Central config. Move API_KEY to .env in production.
export const API_KEY = 'get ur key from google cloud console youtube v3 api key ';
export const YT_BASE = 'https://www.googleapis.com/youtube/v3';
export const DEFAULT_RESULTS = 10;

// Where downloaded files go by default
import os from 'os';
import path from 'path';
export const DOWNLOAD_DIR = path.join(os.homedir(), 'Music', 'MusiCLI');
