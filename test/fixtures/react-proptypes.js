const React = Object;

class Foo extends React {

  props: {
    bar: string;
  };

  render() {

  }

}

export default function demo (props) {
  const error = Foo.propTypes.bar(props, 'bar', 'Foo');
  if (error) {
    throw error;
  }
}
