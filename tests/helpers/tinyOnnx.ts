/**
 * Testler için en küçük "Piper benzeri" ONNX modeli: Piper'ın girdileri (`input` int64 [1, n], `input_lengths`
 * int64 [1], `scales` float [3], çok konuşmacılıysa `sid` int64 [1]) ve tek çıktısı (`output`, float). Çıktı
 * `Cast(input) * ReduceSum(scales)`: ses değil ama ONNX Runtime oturumu açılır ve çalışır. Dosya diske yazılmaz,
 * testte üretilir (depoya model konmaz).
 */

/** Protobuf alanları: varint, uzunluklu (ileti, metin, bayt) */
const enc = new TextEncoder();

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

const key = (field: number, wire: number) => varint(field * 8 + wire);
const int = (field: number, n: number) => [...key(field, 0), ...varint(n)];
const bytes = (field: number, data: number[] | Uint8Array) => [
  ...key(field, 2),
  ...varint(data.length),
  ...data,
];
const str = (field: number, s: string) => bytes(field, enc.encode(s));

/** TensorProto.DataType */
const FLOAT = 1;
const INT64 = 7;

/** ValueInfoProto: ad, tensör türü ve boyutlar (sayı ya da adlı boyut) */
function valueInfo(name: string, elem: number, dims: (number | string)[]): number[] {
  const shape = dims.flatMap((d) => bytes(1, typeof d === 'number' ? int(1, d) : str(2, d)));
  const tensor = [...int(1, elem), ...bytes(2, shape)];
  return [...str(1, name), ...bytes(2, bytes(1, tensor))];
}

/** NodeProto: girdiler, çıktılar, işlem ve tamsayı öznitelikleri */
function node(op: string, inputs: string[], outputs: string[], attrs: Record<string, number> = {}) {
  return [
    ...inputs.flatMap((i) => str(1, i)),
    ...outputs.flatMap((o) => str(2, o)),
    ...str(4, op),
    ...Object.entries(attrs).flatMap(([name, i]) =>
      // AttributeProto: name (1), i (3), type (20) = INT (2)
      bytes(5, [...str(1, name), ...int(3, i), ...int(20, 2)]),
    ),
  ];
}

export interface TinyOnnxOptions {
  /** `scales` girdisi olmasın (eksik girdili, bozuk bir ses gibi) */
  withoutScales?: boolean;
  /** `sid` girdisi (çok konuşmacılı ses) */
  withSid?: boolean;
}

export function tinyPiperOnnx({ withoutScales = false, withSid = false }: TinyOnnxOptions = {}) {
  const inputs = [
    valueInfo('input', INT64, [1, 'phonemes']),
    valueInfo('input_lengths', INT64, [1]),
    ...(withoutScales ? [] : [valueInfo('scales', FLOAT, [3])]),
    ...(withSid ? [valueInfo('sid', INT64, [1])] : []),
  ];
  const nodes = [
    node('Cast', ['input'], ['ids'], { to: FLOAT }),
    ...(withoutScales
      ? [node('Identity', ['ids'], ['output'])]
      : [
          node('ReduceSum', ['scales'], ['total'], { keepdims: 1 }),
          node('Mul', ['ids', 'total'], ['output']),
        ]),
  ];
  const graph = [
    ...nodes.flatMap((n) => bytes(1, n)),
    ...str(2, 'tiny-piper'),
    ...inputs.flatMap((i) => bytes(11, i)),
    ...bytes(12, valueInfo('output', FLOAT, [1, 'samples'])),
  ];
  // ModelProto: ir_version (1) = 8, graph (7), opset_import (8): "" 13
  return new Uint8Array([
    ...int(1, 8),
    ...str(2, 'mypdfbook-test'),
    ...bytes(7, graph),
    ...bytes(8, int(2, 13)),
  ]);
}
