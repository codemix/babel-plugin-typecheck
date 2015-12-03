function findBlocks(el: HTMLElement): Array<HTMLElement> {
  let blocks = [];

  if (el.hasAttribute('rt-is') || getComponentSubclass(el.tagName.toLowerCase())) {
    blocks.push(el);
  }

  blocks.push.apply(blocks, el.querySelectorAll(getComponentSelector()));

  return blocks;
}


export default function demo () {

}