type TypeDateTime = {
    date: string,
    time: string
};

type TypeAction = {
    data: Object,
    name: string
};

const demo = ({date, time}: TypeDateTime) : TypeAction => ({
    data: {
        date,
        time
    },
    name: 'DATE_TIME'
});


export default demo;
