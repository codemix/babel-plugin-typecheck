type Visitors = {
  [key: string]: Visitor
}

type Visitor = (path: NodePath) => void;


export default function demo (visitor: Visitor): Visitors {
  return {
    foo: visitor
  };
}
