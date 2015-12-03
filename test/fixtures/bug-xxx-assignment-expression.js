const HEADER_OFFSET = 1;
const NEXT_OFFSET = 2;
const FIRST_BLOCK = 3;

function writeInitialHeader (int32Array: Int32Array) {
  const header = HEADER_OFFSET;
  const block = FIRST_BLOCK;
  int32Array[header + NEXT_OFFSET] = block;
}

export default function demo () {

}