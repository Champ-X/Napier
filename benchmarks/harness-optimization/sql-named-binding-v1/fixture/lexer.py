import re
def parameter_spans(sql):
    return [(m.start(),m.end(),m.group(1)) for m in re.finditer(r':(\w+)',sql)]
