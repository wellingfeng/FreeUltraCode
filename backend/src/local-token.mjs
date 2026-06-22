import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { arch, cpus, hostname, platform } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TOKEN_CONTEXT = 'UltraGameStudio local runner token v1';
const TOKEN_HEX_LENGTH = 48;

const PLACEHOLDER_VALUES = new Set([
  'default string',
  'none',
  'null',
  'o.e.m.',
  'system serial number',
  'to be filled by o.e.m.',
  'unknown',
]);

function normalizeFactName(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '.')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .toLowerCase();
}

function normalizeFactValue(value) {
  const text = String(value ?? '')
    .replace(/\0/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!text || PLACEHOLDER_VALUES.has(text)) return '';

  const compact = text.replace(/[-{}\s]/g, '');
  if (compact && (/^0+$/.test(compact) || /^f+$/.test(compact))) return '';

  return text;
}

function addFact(facts, name, value) {
  const normalizedName = normalizeFactName(name);
  const normalizedValue = normalizeFactValue(value);
  if (normalizedName && normalizedValue) facts.push({ name: normalizedName, value: normalizedValue });
}

function commandOutput(command, args, timeout = 5000) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
      windowsHide: true,
    });
  } catch {
    return '';
  }
}

function windowsMachineGuidFacts() {
  const facts = [];
  const raw = commandOutput('reg.exe', [
    'query',
    'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
    '/v',
    'MachineGuid',
  ]);
  const match = raw.match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i);
  if (match) addFact(facts, 'windows.machineGuid', match[1]);
  return facts;
}

function windowsCimFacts() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$items = New-Object System.Collections.Generic.List[object]
function Add-Fact($name, $value) {
  if ($null -eq $value) { return }
  $text = ([string]$value).Trim()
  if ($text.Length -eq 0) { return }
  $items.Add([pscustomobject]@{ name = $name; value = $text })
}
Get-CimInstance Win32_ComputerSystemProduct | ForEach-Object {
  Add-Fact 'system.uuid' $_.UUID
  Add-Fact 'system.vendor' $_.Vendor
  Add-Fact 'system.name' $_.Name
}
Get-CimInstance Win32_BIOS | ForEach-Object {
  Add-Fact 'bios.serial' $_.SerialNumber
}
Get-CimInstance Win32_BaseBoard | ForEach-Object {
  Add-Fact 'baseboard.serial' $_.SerialNumber
  Add-Fact 'baseboard.product' $_.Product
}
Get-CimInstance Win32_Processor | ForEach-Object {
  Add-Fact 'cpu.processorId' $_.ProcessorId
  Add-Fact 'cpu.name' $_.Name
}
Get-CimInstance Win32_VideoController | ForEach-Object {
  Add-Fact 'gpu.pnpDeviceId' $_.PNPDeviceID
  Add-Fact 'gpu.name' $_.Name
}
Get-CimInstance Win32_DiskDrive | Where-Object {
  $_.InterfaceType -ne 'USB' -and ($_.MediaType -match 'fixed|ssd|hard disk' -or [string]::IsNullOrWhiteSpace($_.MediaType))
} | ForEach-Object {
  Add-Fact 'disk.serial' $_.SerialNumber
  Add-Fact 'disk.model' $_.Model
}
$items | ConvertTo-Json -Compress
`;

  const raw = commandOutput('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], 8000).trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const facts = [];
    for (const item of items) addFact(facts, item?.name, item?.value);
    return facts;
  } catch {
    return [];
  }
}

function linuxFacts() {
  const facts = [];
  for (const file of [
    '/etc/machine-id',
    '/var/lib/dbus/machine-id',
    '/sys/class/dmi/id/product_uuid',
    '/sys/class/dmi/id/product_serial',
    '/sys/class/dmi/id/board_serial',
  ]) {
    if (!existsSync(file)) continue;
    try {
      addFact(facts, file.replace(/^\/+/, '').replaceAll('/', '.'), readFileSync(file, 'utf8'));
    } catch {
      // Ignore unreadable hardware files; other facts still provide stability.
    }
  }

  try {
    const byId = '/dev/disk/by-id';
    for (const name of readdirSync(byId)) {
      if (!/usb|wwn-0x0/i.test(name)) addFact(facts, 'disk.byId', name);
    }
  } catch {
    // Optional on minimal Linux installs.
  }

  const gpu = commandOutput('sh', [
    '-lc',
    "command -v lspci >/dev/null 2>&1 && lspci | grep -Ei 'vga|3d|display' || true",
  ]);
  for (const line of gpu.split(/\r?\n/)) addFact(facts, 'gpu.pci', line);
  return facts;
}

function darwinFacts() {
  const facts = [];
  const raw = commandOutput('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
  for (const [, key, value] of raw.matchAll(/"([^"]+)"\s+=\s+"([^"]+)"/g)) {
    if (key === 'IOPlatformUUID') addFact(facts, 'mac.platformUuid', value);
    if (key === 'IOPlatformSerialNumber') addFact(facts, 'mac.platformSerial', value);
  }
  return facts;
}

function baselineFacts() {
  const facts = [];
  addFact(facts, 'os.platform', platform());
  addFact(facts, 'os.arch', arch());
  for (const cpu of cpus()) addFact(facts, 'cpu.model', cpu.model);
  return facts;
}

function fallbackFacts() {
  const facts = baselineFacts();
  addFact(facts, 'fallback.hostname', hostname());
  return facts;
}

export function normalizeHardwareFacts(rawFacts) {
  const facts = [];
  for (const fact of rawFacts ?? []) {
    if (Array.isArray(fact)) addFact(facts, fact[0], fact[1]);
    else addFact(facts, fact?.name, fact?.value);
  }

  const seen = new Set();
  return facts
    .sort((a, b) => `${a.name}\0${a.value}`.localeCompare(`${b.name}\0${b.value}`))
    .filter((fact) => {
      const key = `${fact.name}\0${fact.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function tokenFromHardwareFacts(rawFacts) {
  const facts = normalizeHardwareFacts(rawFacts);
  if (!facts.length) throw new Error('No hardware facts available for local runner token.');
  return createHash('sha256')
    .update(TOKEN_CONTEXT)
    .update('\0')
    .update(JSON.stringify(facts))
    .digest('hex')
    .slice(0, TOKEN_HEX_LENGTH);
}

export function collectHardwareFacts() {
  const facts = baselineFacts();
  let platformFacts = [];
  if (platform() === 'win32') {
    platformFacts = windowsMachineGuidFacts().concat(windowsCimFacts());
  } else if (platform() === 'linux') {
    platformFacts = linuxFacts();
  } else if (platform() === 'darwin') {
    platformFacts = darwinFacts();
  }

  if (normalizeHardwareFacts(platformFacts).length) {
    return normalizeHardwareFacts(facts.concat(platformFacts));
  }

  return normalizeHardwareFacts(facts.concat(fallbackFacts()));
}

export function generateLocalRunnerToken() {
  return tokenFromHardwareFacts(collectHardwareFacts());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(generateLocalRunnerToken());
}
