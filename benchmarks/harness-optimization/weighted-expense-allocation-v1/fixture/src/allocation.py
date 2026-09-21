def allocate(total,weights,caps=None):
 n=len(weights);return {k:round(total/n) for k in weights}
