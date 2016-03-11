const Component = Object;
let _tmp;

function decorator(Component) {
  _tmp = Component;
  return true;
}

@decorator
class Foo extends Component {

  props: {
    bar: string;
  };

  render() {
  }

}

export default function demo (props) {
  const error = _tmp.propTypes.bar(props, 'bar', 'Foo');
  if (error) {
    throw error;
  }
}
