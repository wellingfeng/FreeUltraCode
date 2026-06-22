/**
 * CONTRACT: language set + aliases for rehype-highlight (lowlight under the hood).
 *
 * `rehype-highlight` accepts a `languages` record (Record<string, LanguageFn>)
 * and builds its own lowlight instance internally; it does NOT take a prebuilt
 * lowlight instance. We register only the languages UltraGameStudio's AI output
 * actually emits (web + workflow scripting) so the highlighter stays ~30-40KB gz
 * instead of pulling highlight.js's full "common" bundle. Unknown languages fall
 * back to auto-detect / plain text — lowlight never throws on partial input.
 *
 *   HL_LANGUAGES -> pass as rehype-highlight `languages`
 *   HL_ALIASES   -> pass as rehype-highlight `aliases`
 */

import type { LanguageFn } from 'highlight.js';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dos from 'highlight.js/lib/languages/dos';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import glsl from 'highlight.js/lib/languages/glsl';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shellSession from 'highlight.js/lib/languages/shell';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const hlsl: LanguageFn = (hljs) => ({
  name: 'HLSL',
  aliases: [
    'fx',
    'fxh',
    'cg',
    'cginc',
    'usf',
    'ush',
  ],
  keywords: {
    keyword:
      'asm asm_fragment blendstate break buffer case cbuffer centroid class column_major compile ' +
      'compile_fragment const continue default depthstencilstate depthstencilview discard do domain ' +
      'dword else export extern for fxgroup geometry groupshared if in inline inout interface line ' +
      'lineadj linear matrix namespace nointerpolation noperspective out packoffset pass pixelfragment ' +
      'point precise rasterizerstate register return row_major sample sampler samplerstate ' +
      'samplercomparisonstate shared snorm stateblock stateblock_state static string struct switch ' +
      'tbuffer technique technique10 technique11 texture texture1d texture1darray texture2d ' +
      'texture2darray texture2dms texture2dmsarray texture3d texturecube texturecubearray triangle ' +
      'triangleadj uniform unorm vector vertex void volatile while',
    type:
      'bool bool1 bool2 bool3 bool4 bool1x1 bool1x2 bool1x3 bool1x4 bool2x1 bool2x2 bool2x3 ' +
      'bool2x4 bool3x1 bool3x2 bool3x3 bool3x4 bool4x1 bool4x2 bool4x3 bool4x4 double double1 ' +
      'double2 double3 double4 float float1 float2 float3 float4 float1x1 float1x2 float1x3 ' +
      'float1x4 float2x1 float2x2 float2x3 float2x4 float3x1 float3x2 float3x3 float3x4 ' +
      'float4x1 float4x2 float4x3 float4x4 half half1 half2 half3 half4 half1x1 half1x2 ' +
      'half1x3 half1x4 half2x1 half2x2 half2x3 half2x4 half3x1 half3x2 half3x3 half3x4 ' +
      'half4x1 half4x2 half4x3 half4x4 int int1 int2 int3 int4 int1x1 int1x2 int1x3 int1x4 ' +
      'int2x1 int2x2 int2x3 int2x4 int3x1 int3x2 int3x3 int3x4 int4x1 int4x2 int4x3 int4x4 ' +
      'uint uint1 uint2 uint3 uint4 min16float min16float2 min16float3 min16float4 min10float ' +
      'min10float2 min10float3 min10float4 min16int min16int2 min16int3 min16int4 min12int ' +
      'min12int2 min12int3 min12int4 min16uint min16uint2 min16uint3 min16uint4 Texture1D ' +
      'Texture1DArray Texture2D Texture2DArray Texture2DMS Texture2DMSArray Texture3D TextureCube ' +
      'TextureCubeArray RWTexture1D RWTexture1DArray RWTexture2D RWTexture2DArray RWTexture3D ' +
      'Buffer RWBuffer StructuredBuffer RWStructuredBuffer ByteAddressBuffer RWByteAddressBuffer ' +
      'AppendStructuredBuffer ConsumeStructuredBuffer InputPatch OutputPatch RayDesc RaytracingAccelerationStructure',
    built_in:
      'abort abs acos all AllMemoryBarrier AllMemoryBarrierWithGroupSync any asdouble asfloat asin ' +
      'asint asuint atan atan2 ceil CheckAccessFullyMapped clamp clip cos cosh countbits cross ' +
      'D3DCOLORtoUBYTE4 ddx ddx_coarse ddx_fine ddy ddy_coarse ddy_fine degrees determinant ' +
      'DeviceMemoryBarrier DeviceMemoryBarrierWithGroupSync distance dot dst EvaluateAttributeAtCentroid ' +
      'EvaluateAttributeAtSample EvaluateAttributeSnapped exp exp2 f16tof32 f32tof16 faceforward firstbithigh ' +
      'firstbitlow floor fma fmod frac frexp fwidth GetRenderTargetSampleCount GetRenderTargetSamplePosition ' +
      'GroupMemoryBarrier GroupMemoryBarrierWithGroupSync InterlockedAdd InterlockedAnd InterlockedCompareExchange ' +
      'InterlockedCompareStore InterlockedExchange InterlockedMax InterlockedMin InterlockedOr InterlockedXor ' +
      'isfinite isinf isnan ldexp length lerp lit log log10 log2 mad max min modf msad4 mul noise normalize ' +
      'pow printf Process2DQuadTessFactorsAvg Process2DQuadTessFactorsMax Process2DQuadTessFactorsMin ' +
      'ProcessIsolineTessFactors ProcessQuadTessFactorsAvg ProcessQuadTessFactorsMax ProcessQuadTessFactorsMin ' +
      'ProcessTriTessFactorsAvg ProcessTriTessFactorsMax ProcessTriTessFactorsMin radians rcp reflect refract ' +
      'reversebits round rsqrt saturate sign sin sincos sinh smoothstep sqrt step tan tanh tex1D tex1Dbias ' +
      'tex1Dgrad tex1Dlod tex1Dproj tex2D tex2Dbias tex2Dgrad tex2Dlod tex2Dproj tex3D tex3Dbias ' +
      'tex3Dgrad tex3Dlod tex3Dproj texCUBE texCUBEbias texCUBEgrad texCUBElod texCUBEproj transpose trunc',
    literal: 'true false NULL',
  },
  contains: [
    hljs.C_LINE_COMMENT_MODE,
    hljs.C_BLOCK_COMMENT_MODE,
    hljs.C_NUMBER_MODE,
    hljs.QUOTE_STRING_MODE,
    hljs.APOS_STRING_MODE,
    {
      className: 'meta',
      begin: '#',
      end: '$',
    },
    {
      className: 'title.function_',
      begin: /\b[A-Za-z_]\w*(?=\s*\()/,
      relevance: 0,
    },
  ],
});

export const HL_LANGUAGES: Record<string, LanguageFn> = {
  bash,
  c,
  cpp,
  css,
  csharp,
  diff,
  dos,
  glsl,
  hlsl,
  javascript,
  json,
  markdown,
  plaintext,
  powershell,
  python,
  rust,
  shellsession: shellSession,
  typescript,
  xml,
  yaml,
};

/** Common fence-info aliases the model emits → canonical registered ids. */
export const HL_ALIASES: Record<string, string | string[]> = {
  typescript: ['ts', 'tsx'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  cpp: ['cc', 'cxx', 'c++', 'hpp', 'hh', 'hxx'],
  csharp: ['cs'],
  hlsl: ['fx', 'fxh', 'cg', 'cginc', 'usf', 'ush'],
  glsl: ['vert', 'frag', 'geom', 'tesc', 'tese', 'comp'],
  bash: ['sh', 'shell', 'zsh'],
  powershell: ['ps1', 'pwsh', 'ps'],
  dos: ['bat', 'cmd'],
  shellsession: ['console'],
  python: ['py'],
  xml: ['html', 'svg', 'vue'],
  markdown: ['md'],
  yaml: ['yml'],
  plaintext: ['text', 'txt'],
};

const HL_REGISTERED = new Set<string>();

function ensureHighlightLanguages(): void {
  for (const [name, lang] of Object.entries(HL_LANGUAGES)) {
    if (HL_REGISTERED.has(name)) continue;
    hljs.registerLanguage(name, lang);
    HL_REGISTERED.add(name);
  }
  for (const [languageName, aliases] of Object.entries(HL_ALIASES)) {
    if (!hljs.getLanguage(languageName)) continue;
    hljs.registerAliases(aliases, { languageName });
  }
}

export function highlightCode(
  code: string,
  language?: string | null,
): { html: string; className: string } {
  ensureHighlightLanguages();
  const lang = language?.trim().toLowerCase();
  if (lang && hljs.getLanguage(lang)) {
    return {
      html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value,
      className: `hljs language-${lang}`,
    };
  }
  return {
    html: hljs.highlight(code, { language: 'plaintext', ignoreIllegals: true }).value,
    className: 'hljs language-plaintext',
  };
}
