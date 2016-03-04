const React = Object;

type Props = {
  bar: string;
}

class Foo extends React<void,Props,void> {

  render() {

  }

}

export default function demo (props) {
  const error = Foo.propTypes.bar(props, 'bar', 'Foo');
  if (error) {
    throw error;
  }
}
